import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  if (!process.env.VERCEL) {
    process.exit(1);
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Rate limiting for authentication endpoint
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 authentication attempts per windowMs
  message: {
    error: 'Too many authentication attempts from this IP, please try again after 15 minutes.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// General rate limiting for API endpoints
const apiRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again after a minute.'
  }
});

// Security headers middleware
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Strict transport security (HTTPS only)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // Basic Content Security Policy
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:;");
  
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api', apiRateLimit); // Apply rate limiting to all API routes

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Filter applied to every listing endpoint to suppress fully-redacted personnel
// (last_name="XXXXXXX") from the public-facing roster/search results. Direct profile
// lookups by id still resolve so deep links keep working.
const VISIBLE_FILTER = "is_current = true AND last_name NOT LIKE 'XXXX%'";

// API Routes
app.get('/api/personnel', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM personnel WHERE ${VISIBLE_FILTER} ORDER BY last_name ASC`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching personnel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/personnel/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM personnel WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Personnel not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching personnel by id:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/personnel/search', async (req, res) => {
  try {
    const { firstName, lastName, badgeNumber, division, sortBy = 'name', sortOrder = 'asc' } = req.body;
    const page = Math.max(1, parseInt(req.body.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.body.pageSize) || 20));

    // Build WHERE conditions and parameters
    const whereConditions = ["is_current = true", "last_name NOT LIKE 'XXXX%'"];
    const queryParams = [];
    let paramCount = 0;

    // Apply search filters with smart logic
    if (firstName && lastName && firstName === lastName) {
      // Single name search: use OR logic to search both first and last name fields
      const searchTerm = firstName.trim();
      paramCount++;
      whereConditions.push(`(first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount})`);
      queryParams.push(`%${searchTerm}%`);
    } else {
      // Full name search: use AND logic for separate first and last names
      if (firstName && firstName.trim()) {
        paramCount++;
        whereConditions.push(`first_name ILIKE $${paramCount}`);
        queryParams.push(`%${firstName}%`);
      }
      
      if (lastName && lastName.trim()) {
        paramCount++;
        whereConditions.push(`last_name ILIKE $${paramCount}`);
        queryParams.push(`%${lastName}%`);
      }
    }
    
    if (badgeNumber && badgeNumber.trim()) {
      paramCount++;
      whereConditions.push(`badge_number ILIKE $${paramCount}`);
      queryParams.push(`%${badgeNumber}%`);
    }

    // Apply division filter
    if (division) {
      paramCount++;
      whereConditions.push(`division = $${paramCount}`);
      queryParams.push(division);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) FROM personnel ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Build ORDER BY clause
    let orderByClause = '';
    if (sortBy === 'name') {
      orderByClause = `ORDER BY last_name ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    } else if (sortBy === 'regular_pay') {
      orderByClause = `ORDER BY regular_pay ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    } else if (sortBy === 'overtime') {
      orderByClause = `ORDER BY overtime ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    } else {
      // For total compensation, we'll sort client-side since it's calculated
      orderByClause = `ORDER BY regular_pay ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    }

    // Apply pagination with parameterized values
    const startIndex = (page - 1) * pageSize;
    paramCount++;
    const limitParam = paramCount;
    queryParams.push(pageSize);
    paramCount++;
    const offsetParam = paramCount;
    queryParams.push(startIndex);

    // Build main query
    const mainQuery = `
      SELECT * FROM personnel
      ${whereClause}
      ${orderByClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await pool.query(mainQuery, queryParams);
    const totalPages = Math.ceil(totalCount / pageSize);

    res.json({
      data: result.rows,
      totalCount,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error('Error searching personnel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/personnel-filter-options', async (req, res) => {
  try {
    const result = await pool.query(`SELECT DISTINCT division, classification FROM personnel WHERE ${VISIBLE_FILTER} AND (division IS NOT NULL OR classification IS NOT NULL)`);
    
    const divisions = [...new Set(result.rows?.map(p => p.division).filter(Boolean))];
    const classifications = [...new Set(result.rows?.map(p => p.classification).filter(Boolean))];

    res.json({ divisions, classifications });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Authentication endpoint with rate limiting
app.post('/api/auth/verify', authRateLimit, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Hash function using built-in crypto
    const hashPassword = async (password, salt) => {
      const crypto = await import('crypto');
      return crypto.createHash('sha256').update(password + salt).digest('hex');
    };

    // Get the stored hash from database
    const result = await pool.query(
      'SELECT value FROM app_config WHERE key = $1',
      ['search_password_hash']
    );

    if (!result.rows[0]) {
      return res.status(500).json({ error: 'Authentication configuration not found' });
    }

    // Hash the input password with the same salt from environment variable
    const salt = process.env.PASSWORD_SALT || 'watch_the_watchers_salt_2024';
    const inputHash = await hashPassword(password, salt);
    
    // Compare hashes
    const isValid = inputHash === result.rows[0].value;
    
    res.json({ valid: isValid });
  } catch (error) {
    console.error('Error verifying password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/personnel/all', async (req, res) => {
  try {
    const { sortBy = 'name', sortOrder = 'asc' } = req.body;
    const page = Math.max(1, parseInt(req.body.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.body.pageSize) || 20));

    // Get total count for pagination
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM personnel WHERE ${VISIBLE_FILTER}`);
    const totalCount = parseInt(countResult.rows[0].count) || 0;

    // Build the main query with sorting
    let orderClause = '';
    if (sortBy === 'name') {
      orderClause = `ORDER BY last_name ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    } else if (sortBy === 'regular_pay') {
      orderClause = `ORDER BY regular_pay ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    } else if (sortBy === 'overtime') {
      orderClause = `ORDER BY overtime ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    } else {
      // For total compensation, we'll sort client-side since it's calculated
      orderClause = `ORDER BY regular_pay ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
    }

    // Apply pagination
    const startIndex = (page - 1) * pageSize;
    const query = `
      SELECT * FROM personnel
      WHERE ${VISIBLE_FILTER}
      ${orderClause}
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(query, [pageSize, startIndex]);
    const totalPages = Math.ceil(totalCount / pageSize);

    res.json({
      data: result.rows,
      totalCount,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error('Error fetching all personnel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search personnel with simple search term
app.post('/api/personnel/search-simple', async (req, res) => {
  try {
    const { searchTerm } = req.body;
    
    if (!searchTerm?.trim()) {
      const result = await pool.query(`SELECT * FROM personnel WHERE ${VISIBLE_FILTER} ORDER BY last_name ASC`);
      return res.json(result.rows);
    }

    const searchPattern = `%${searchTerm}%`;
    const result = await pool.query(
      `SELECT * FROM personnel
       WHERE ${VISIBLE_FILTER} AND (
          last_name ILIKE $1
          OR first_name ILIKE $1
          OR badge_number ILIKE $1
       )
       ORDER BY last_name ASC`,
      [searchPattern]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error searching personnel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get statistics and aggregates
app.post('/api/personnel/stats', async (req, res) => {
  try {
    const { type, filters = {} } = req.body;
    
    if (type === 'top-salaries') {
      const { division, classification, sortBy = 'total_compensation' } = filters;
      const limit = Math.min(500, Math.max(1, parseInt(filters.limit) || 50));

      let whereClause = VISIBLE_FILTER;
      const params = [];
      let paramCount = 0;

      if (division) {
        whereClause += ` AND division = $${++paramCount}`;
        params.push(division);
      }

      if (classification) {
        whereClause += ` AND classification = $${++paramCount}`;
        params.push(classification);
      }

      paramCount++;
      params.push(limit);

      const query = `
        SELECT * FROM personnel
        WHERE ${whereClause}
        LIMIT $${paramCount}
      `;

      const result = await pool.query(query, params);
      res.json(result.rows);

    } else if (type === 'aggregates') {
      const result = await pool.query(`SELECT * FROM personnel WHERE ${VISIBLE_FILTER}`);
      res.json(result.rows);

    } else if (type === 'unique-values') {
      const result = await pool.query(`SELECT DISTINCT division, classification FROM personnel WHERE ${VISIBLE_FILTER}`);
      res.json(result.rows);
      
    } else {
      res.status(400).json({ error: 'Invalid stats type' });
    }
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve React app for all non-API routes (not needed on Vercel)
if (!process.env.VERCEL) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

// Only start listener when running directly (not as Vercel serverless function)
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

// Export for Vercel serverless
export default app;