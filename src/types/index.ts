
export interface Personnel {
  id: string;
  last_name: string;
  first_name: string;
  classification?: string;
  badge_number?: string;
  division?: string;
  regular_pay?: number;
  premiums?: number;
  overtime?: number;
  payout?: number;
  other_pay?: number;
  health_dental_vision?: number;
  gender?: string;
  ethnicity?: string;
  height?: string;
  weight?: number;
  year_of_hire?: number;
  rank_title?: string;
  roster_year?: number;
  payroll_year?: number;
  is_current?: boolean;
  created_at?: string;
  updated_at?: string;
}

// Helper function to get full name
export const getFullName = (person: Personnel): string => {
  return `${person.first_name} ${person.last_name}`;
}

// Helper function to get total compensation
export const getTotalCompensation = (person: Personnel): number => {
  // Force number conversion and addition
  const regular_pay = parseFloat(person.regular_pay?.toString() || '0') || 0;
  const premiums = parseFloat(person.premiums?.toString() || '0') || 0;
  const overtime = parseFloat(person.overtime?.toString() || '0') || 0;
  const payout = parseFloat(person.payout?.toString() || '0') || 0;
  const other_pay = parseFloat(person.other_pay?.toString() || '0') || 0;
  const health_dental_vision = parseFloat(person.health_dental_vision?.toString() || '0') || 0;

  // Development-only debugging
  if (process.env.NODE_ENV === 'development') {
    console.log('getTotalCompensation debug:', {
      regular_pay, premiums, overtime, payout, other_pay, health_dental_vision
    });
  }

  // Explicit mathematical addition
  return regular_pay + premiums + overtime + payout + other_pay + health_dental_vision;
};