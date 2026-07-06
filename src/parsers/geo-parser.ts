/**
 * Geo Parser - Extracts country and city information from text using keyword matching.
 * Uses a predefined list of countries and major cities for matching.
 */

// Geo parser uses keyword matching against predefined location lists

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeoLocation {
  country: string;
  city: string | null;
}

// ─── Country/City Data ───────────────────────────────────────────────────────

const COUNTRIES_WITH_CITIES: Record<string, string[]> = {
  'United States': [
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
    'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
    'San Francisco', 'Seattle', 'Denver', 'Nashville', 'Miami', 'Atlanta',
    'Las Vegas', 'Portland', 'Detroit', 'Minneapolis', 'Tampa', 'Orlando',
    'Boston', 'Charlotte', 'St. Louis', 'Pittsburgh', 'Baltimore', 'Sacramento',
    'Washington D.C.', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island',
  ],
  'United Kingdom': [
    'London', 'Manchester', 'Birmingham', 'Liverpool', 'Leeds', 'Glasgow',
    'Edinburgh', 'Bristol', 'Sheffield', 'Cardiff', 'Belfast', 'Nottingham',
    'Newcastle', 'Southampton', 'Oxford', 'Cambridge', 'Brighton',
  ],
  'Canada': [
    'Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton',
    'Winnipeg', 'Quebec City', 'Hamilton', 'Halifax',
  ],
  'Australia': [
    'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast',
    'Canberra', 'Hobart', 'Darwin',
  ],
  'Brazil': [
    'São Paulo', 'Sao Paulo', 'Rio de Janeiro', 'Brasilia', 'Salvador',
    'Fortaleza', 'Belo Horizonte', 'Curitiba', 'Recife', 'Porto Alegre',
  ],
  'India': [
    'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata',
    'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'New Delhi',
  ],
  'China': [
    'Beijing', 'Shanghai', 'Shenzhen', 'Guangzhou', 'Chengdu', 'Hangzhou',
    'Hong Kong', 'Macau', 'Wuhan', 'Nanjing', 'Tianjin',
  ],
  'Russia': [
    'Moscow', 'St. Petersburg', 'Saint Petersburg', 'Novosibirsk', 'Yekaterinburg',
    'Kazan', 'Sochi',
  ],
  'Nigeria': [
    'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan',
  ],
  'South Africa': [
    'Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth',
  ],
  'Mexico': [
    'Mexico City', 'Guadalajara', 'Monterrey', 'Cancun', 'Tijuana', 'Puebla',
  ],
  'Colombia': [
    'Bogota', 'Medellin', 'Cali', 'Barranquilla', 'Cartagena',
  ],
  'Argentina': [
    'Buenos Aires', 'Córdoba', 'Cordoba', 'Rosario', 'Mendoza',
  ],
  'Thailand': [
    'Bangkok', 'Chiang Mai', 'Phuket', 'Pattaya', 'Krabi',
  ],
  'Philippines': [
    'Manila', 'Cebu', 'Davao', 'Quezon City',
  ],
  'Turkey': [
    'Istanbul', 'Ankara', 'Izmir', 'Antalya',
  ],
  'Netherlands': [
    'Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven',
  ],
  'Germany': [
    'Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne', 'Stuttgart', 'Düsseldorf',
  ],
  'France': [
    'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Bordeaux', 'Strasbourg',
  ],
  'Spain': [
    'Madrid', 'Barcelona', 'Valencia', 'Seville', 'Malaga', 'Bilbao',
  ],
  'Italy': [
    'Rome', 'Milan', 'Naples', 'Turin', 'Florence', 'Venice', 'Bologna',
  ],
  'Japan': [
    'Tokyo', 'Osaka', 'Kyoto', 'Yokohama', 'Nagoya', 'Sapporo', 'Fukuoka',
  ],
  'South Korea': [
    'Seoul', 'Busan', 'Incheon', 'Daegu',
  ],
  'Singapore': ['Singapore'],
  'UAE': [
    'Dubai', 'Abu Dhabi', 'Sharjah',
  ],
  'Switzerland': [
    'Zurich', 'Geneva', 'Basel', 'Bern', 'Lausanne', 'Zug',
  ],
  'Sweden': [
    'Stockholm', 'Gothenburg', 'Malmö', 'Malmo',
  ],
  'Norway': [
    'Oslo', 'Bergen', 'Trondheim',
  ],
  'Denmark': [
    'Copenhagen',
  ],
  'Finland': [
    'Helsinki',
  ],
  'Portugal': [
    'Lisbon', 'Porto',
  ],
  'Poland': [
    'Warsaw', 'Krakow', 'Gdansk',
  ],
  'Ukraine': [
    'Kyiv', 'Kiev', 'Odessa', 'Kharkiv', 'Lviv',
  ],
  'Indonesia': [
    'Jakarta', 'Bali', 'Surabaya', 'Bandung',
  ],
  'Malaysia': [
    'Kuala Lumpur', 'Penang', 'Johor Bahru',
  ],
  'Vietnam': [
    'Ho Chi Minh City', 'Hanoi', 'Da Nang',
  ],
  'Taiwan': [
    'Taipei', 'Kaohsiung', 'Taichung',
  ],
  'Israel': [
    'Tel Aviv', 'Jerusalem', 'Haifa',
  ],
  'Kenya': [
    'Nairobi', 'Mombasa',
  ],
  'Ghana': [
    'Accra',
  ],
  'Egypt': [
    'Cairo', 'Alexandria',
  ],
  'Pakistan': [
    'Karachi', 'Lahore', 'Islamabad',
  ],
  'Bangladesh': [
    'Dhaka', 'Chittagong',
  ],
  'Venezuela': [
    'Caracas', 'Maracaibo',
  ],
  'Chile': [
    'Santiago', 'Valparaiso',
  ],
  'Peru': [
    'Lima', 'Cusco',
  ],
  'Costa Rica': [
    'San Jose',
  ],
  'Panama': [
    'Panama City',
  ],
  'Puerto Rico': [
    'San Juan',
  ],
  'El Salvador': [
    'San Salvador',
  ],
  'Honduras': [
    'Tegucigalpa',
  ],
  'Jamaica': [
    'Kingston',
  ],
  'Trinidad and Tobago': [
    'Port of Spain',
  ],
};

// Country name aliases
const COUNTRY_ALIASES: Record<string, string> = {
  'US': 'United States',
  'USA': 'United States',
  'U.S.': 'United States',
  'U.S.A.': 'United States',
  'America': 'United States',
  'UK': 'United Kingdom',
  'U.K.': 'United Kingdom',
  'Britain': 'United Kingdom',
  'England': 'United Kingdom',
  'Scotland': 'United Kingdom',
  'Wales': 'United Kingdom',
  'Northern Ireland': 'United Kingdom',
  'UAE': 'UAE',
  'U.A.E.': 'UAE',
  'United Arab Emirates': 'UAE',
  'Holland': 'Netherlands',
  'The Netherlands': 'Netherlands',
  'S. Korea': 'South Korea',
  'HK': 'China',
  'Hong Kong': 'China',
};

// US state abbreviations and names (for detecting US locations)
const US_STATES: string[] = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas',
  'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming',
];

// ─── Parser Logic ────────────────────────────────────────────────────────────

/**
 * Extract geographic location (country and city) from text.
 * Uses keyword matching against predefined lists.
 */
export function parseGeoLocation(text: string): GeoLocation {
  const defaultResult: GeoLocation = { country: 'Unknown', city: null };

  if (!text || text.trim().length === 0) {
    return defaultResult;
  }

  // Normalize text for matching
  const normalizedText = text.replace(/\s+/g, ' ');

  let detectedCountry: string | null = null;
  let detectedCity: string | null = null;

  // First, try to match city names (more specific)
  for (const [country, cities] of Object.entries(COUNTRIES_WITH_CITIES)) {
    for (const city of cities) {
      // Use word boundary matching to avoid partial matches
      const cityRegex = new RegExp(`\\b${escapeRegex(city)}\\b`, 'i');
      if (cityRegex.test(normalizedText)) {
        detectedCountry = country;
        detectedCity = city;
        break;
      }
    }
    if (detectedCity) break;
  }

  // If no city found, try country names
  if (!detectedCountry) {
    // Check aliases first
    for (const [alias, country] of Object.entries(COUNTRY_ALIASES)) {
      const aliasRegex = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
      if (aliasRegex.test(normalizedText)) {
        detectedCountry = country;
        break;
      }
    }

    // Check full country names
    if (!detectedCountry) {
      for (const country of Object.keys(COUNTRIES_WITH_CITIES)) {
        const countryRegex = new RegExp(`\\b${escapeRegex(country)}\\b`, 'i');
        if (countryRegex.test(normalizedText)) {
          detectedCountry = country;
          break;
        }
      }
    }
  }

  // Check for US states (implies United States)
  if (!detectedCountry) {
    for (const state of US_STATES) {
      const stateRegex = new RegExp(`\\b${escapeRegex(state)}\\b`, 'i');
      if (stateRegex.test(normalizedText)) {
        detectedCountry = 'United States';
        break;
      }
    }
  }

  return {
    country: detectedCountry ?? 'Unknown',
    city: detectedCity,
  };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
