import { Personnel } from "@/types";

/**
 * Generate potential photo filenames for a personnel record
 * Handles various naming patterns including suffixes (Jr, Sr, II, III, etc.)
 */
export const getPhotoUrl = (person: Personnel): string | null => {
  if (!person.first_name || !person.last_name) return null;
  
  // Generate multiple potential filename variations
  const potentialUrls = generatePhotoVariations(person);
  
  // Return the first variation (most likely based on patterns observed)
  return potentialUrls[0] || null;
};

/**
 * Get all potential photo URL variations for a person
 * Useful for trying multiple possibilities
 */
export const getPhotoUrlVariations = (person: Personnel): string[] => {
  if (!person.first_name || !person.last_name) return [];
  return generatePhotoVariations(person);
};

/**
 * Generate all possible photo filename variations for a person
 */
function generatePhotoVariations(person: Personnel): string[] {
  const variations: string[] = [];
  
  // Clean and format names
  const lastName = person.last_name.toLowerCase().trim();
  const firstName = person.first_name.toLowerCase().trim();
  
  
  // Handle common suffixes and their variations
  const suffixPatterns = [
    { pattern: /\s+(jr\.?|junior)$/i, replacement: '-jr' },
    { pattern: /\s+(sr\.?|senior)$/i, replacement: '-sr' },
    { pattern: /\s+(ii|2nd)$/i, replacement: 'ii' }, // Concatenated directly
    { pattern: /\s+(iii|3rd)$/i, replacement: 'iii' },
    { pattern: /\s+(iv|4th)$/i, replacement: 'iv' },
  ];
  
  // Handle common nickname patterns
  const nicknameMap = {
    'daniel': ['dan'],
    'daniel ': ['dan'],
    'robert': ['rob', 'bob'],
    'william': ['bill', 'will'],
    'richard': ['rick', 'dick'],
    'michael': ['mike'],
    'christopher': ['chris'],
    'matthew': ['matt'],
    'anthony': ['tony']
  };
  
  // Check if lastName has a suffix and create variations
  let baseLastName = lastName;
  let suffixVariation = '';
  
  for (const { pattern, replacement } of suffixPatterns) {
    if (pattern.test(lastName)) {
      baseLastName = lastName.replace(pattern, '');
      suffixVariation = replacement;
      break;
    }
  }
  
  // Replace spaces with underscores and handle hyphens
  const formatName = (name: string) => name.replace(/\s+/g, '_').replace(/['"]/g, '');
  
  const formattedFirstName = formatName(firstName);
  const formattedBaseLastName = formatName(baseLastName);
  
  // Handle compound names - Generate additional variations
  const generateCompoundNameVariations = (first: string, last: string, badge: string, ext: string) => {
    const compoundVariations: string[] = [];
    
    // Handle compound last names (e.g., "Garcia Beltran" -> use last part "beltran")
    if (last.includes('_')) {
      const lastParts = last.split('_');
      // Try using just the last part of compound surname
      compoundVariations.push(`/photos/${lastParts[lastParts.length - 1]}_${first}_${badge}${ext}`);
      
      // Try using first part of compound surname
      compoundVariations.push(`/photos/${lastParts[0]}_${first}_${badge}${ext}`);
    }
    
    // Handle compound first names (e.g., "An Cao" in "An Cao Ngo")
    if (first.includes('_')) {
      const firstParts = first.split('_');
      // Try using just first part of compound first name
      compoundVariations.push(`/photos/${last}_${firstParts[0]}_${badge}${ext}`);
      
      // Try rearranging compound first names (for Asian names)
      if (firstParts.length === 2) {
        compoundVariations.push(`/photos/${last}_${firstParts[1]}_${firstParts[0]}_${badge}${ext}`);
      }
    }
    
    // Handle "De" in names (e.g., "Ponce De Leon" -> "ponce_de_leon")
    if (last.includes('de_')) {
      const deParts = last.split('de_');
      if (deParts.length === 2) {
        compoundVariations.push(`/photos/${deParts[0]}_de_${deParts[1]}_${first}_${badge}${ext}`);
        compoundVariations.push(`/photos/${deParts[0]}_${deParts[1]}_${first}_${badge}${ext}`);
      }
    }
    
    return compoundVariations;
  };
  
  // Redacted personnel (XXXXXXX names) get assigned REDACTED-NNN badge identifiers
  // by the migration. Their photo filename should be a clean "redacted-007.webp"
  // pattern rather than the awkward "xxxxxxx_xxxxxxx_redacted-007.webp" that the
  // generic logic below would produce. If Ben sends photos for these entries later,
  // they can be dropped in under the simple pattern.
  const isRedactedPlaceholder = /^X+$/i.test(lastName.replace(/\s+/g, ''));
  if (isRedactedPlaceholder && person.badge_number && /^REDACTED-/i.test(person.badge_number)) {
    const idLower = person.badge_number.toLowerCase();
    const idUpper = person.badge_number.toUpperCase();
    for (const ext of ['.webp', '.webpX']) {
      variations.push(`/photos/${idLower}${ext}`);
      variations.push(`/photos/${idUpper}${ext}`);
    }
  }

  // Generate variations with badge number for both .webp and .webpX extensions
  if (person.badge_number) {
    const extensions = ['.webp', '.webpX'];
    // Handle case variations in badge numbers (e.g., R369 vs r369)
    const badgeVariations = [
      person.badge_number,
      person.badge_number.toLowerCase(),
      person.badge_number.toUpperCase()
    ];
    
    for (const ext of extensions) {
      for (const badge of badgeVariations) {
        // Generate nickname variations for first name
        const firstNameVariations = [formattedFirstName];
        const lowerFirstName = firstName.toLowerCase();
        if (nicknameMap[lowerFirstName]) {
          firstNameVariations.push(...nicknameMap[lowerFirstName]);
        }

        // Also try a stripped-middle-initial variant. The 2025 payroll CSV stores
        // names like "James D." but the photo files use the base "james". Strips
        // either an underscore-prefixed initial ("_d") or trailing initial-with-period
        // ("_d.") from the end of the formatted first name.
        const strippedFirst = formattedFirstName.replace(/_[a-z]\.?$/i, '');
        if (strippedFirst && strippedFirst !== formattedFirstName) {
          firstNameVariations.push(strippedFirst);
          if (nicknameMap[strippedFirst]) {
            firstNameVariations.push(...nicknameMap[strippedFirst]);
          }
        }
        
        for (const firstNameVar of firstNameVariations) {
          // Variation 1: suffix concatenated directly (like espinozaii_roberto_3770.webp)
          if (suffixVariation && !suffixVariation.startsWith('-')) {
            variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${firstNameVar}_${badge}${ext}`);
          }
          
          // Variation 2: suffix with hyphen (like rodardte-jr_gerardo_3737.webp)
          if (suffixVariation && suffixVariation.startsWith('-')) {
            variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${firstNameVar}_${badge}${ext}`);
          }
          
          // Variation 2b: suffix concatenated as "jr" without hyphen (like castrojr_jorge_3942.webp)
          if (suffixVariation === '-jr') {
            variations.push(`/photos/${formattedBaseLastName}jr_${firstNameVar}_${badge}${ext}`);
          }
          if (suffixVariation === '-sr') {
            variations.push(`/photos/${formattedBaseLastName}sr_${firstNameVar}_${badge}${ext}`);
          }
          
          // Variation 2c: suffix with underscore (like rodarte_jr_gerardo_3737.webp)
          if (suffixVariation === '-jr') {
            variations.push(`/photos/${formattedBaseLastName}_jr_${firstNameVar}_${badge}${ext}`);
          }
          if (suffixVariation === '-sr') {
            variations.push(`/photos/${formattedBaseLastName}_sr_${firstNameVar}_${badge}${ext}`);
          }
          
          // Variation 3: original format without suffix handling
          const formattedLastName = formatName(lastName);
          variations.push(`/photos/${formattedLastName}_${firstNameVar}_${badge}${ext}`);
          
          // Variation 4: base name without suffix
          if (suffixVariation) {
            variations.push(`/photos/${formattedBaseLastName}_${firstNameVar}_${badge}${ext}`);
          }
          
          // Variation 5: compound name variations
          variations.push(...generateCompoundNameVariations(firstNameVar, formattedBaseLastName, badge, ext));
          variations.push(...generateCompoundNameVariations(firstNameVar, formattedLastName, badge, ext));
        }
      }
    }
  }
  
  // Special case: Handle common typos in names
  if (person.last_name.toLowerCase() === 'gonzalez') {
    // Add variation for "gonazalez" typo
    const typoLastName = 'gonazalez';
    const extensions = ['.webp', '.webpX'];
    
    for (const ext of extensions) {
      if (person.badge_number) {
        // Handle case variations in badge numbers for typo variations too
        const badgeVariations = [
          person.badge_number,
          person.badge_number.toLowerCase(),
          person.badge_number.toUpperCase()
        ];
        for (const badge of badgeVariations) {
          variations.push(`/photos/${typoLastName}_${formattedFirstName}_${badge}${ext}`);
        }
      }
      variations.push(`/photos/${typoLastName}_${formattedFirstName}${ext}`);
    }
  }
  
  // Generate variations without badge number for both extensions
  const extensions = ['.webp', '.webpX'];
  
  for (const ext of extensions) {
    if (suffixVariation && !suffixVariation.startsWith('-')) {
      variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${formattedFirstName}${ext}`);
    }
    
    if (suffixVariation && suffixVariation.startsWith('-')) {
      variations.push(`/photos/${formattedBaseLastName}${suffixVariation}_${formattedFirstName}${ext}`);
    }
    
    // Additional variation for concatenated suffixes (castrojr_jorge.webp)
    if (suffixVariation === '-jr') {
      variations.push(`/photos/${formattedBaseLastName}jr_${formattedFirstName}${ext}`);
    }
    if (suffixVariation === '-sr') {
      variations.push(`/photos/${formattedBaseLastName}sr_${formattedFirstName}${ext}`);
    }
    
    const formattedLastName = formatName(lastName);
    variations.push(`/photos/${formattedLastName}_${formattedFirstName}${ext}`);

    if (suffixVariation) {
      variations.push(`/photos/${formattedBaseLastName}_${formattedFirstName}${ext}`);
    }

    // Also try a stripped-middle-initial variant in the no-badge fallback. Catches
    // de-redacted 2025 personnel like "James H. Babinski" who have no badge but
    // could plausibly have a photo file under the base "babinski_james.webp" name.
    const strippedFirstNoB = formattedFirstName.replace(/_[a-z]\.?$/i, '');
    if (strippedFirstNoB && strippedFirstNoB !== formattedFirstName) {
      variations.push(`/photos/${formattedLastName}_${strippedFirstNoB}${ext}`);
      if (suffixVariation) {
        variations.push(`/photos/${formattedBaseLastName}_${strippedFirstNoB}${ext}`);
      }
    }
  }
  
  // Remove duplicates and return
  const uniqueVariations = [...new Set(variations)];
  
  
  return uniqueVariations;
}

/**
 * Check if a photo exists by attempting to load it
 */
export const checkPhotoExists = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
};