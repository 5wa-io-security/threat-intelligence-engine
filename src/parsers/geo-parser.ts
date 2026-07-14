/**
 * Geo Parser - Extracts country, city, and coordinates from text using keyword matching.
 * Uses a predefined list of countries and major cities for matching.
 * Now includes latitude/longitude lookup for map positioning.
 */

// Geo parser uses keyword matching against predefined location lists

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeoLocation {
  country: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

// ─── Coordinate Data ────────────────────────────────────────────────────────

const CITY_COORDS: Record<string, [number, number]> = {
  // France
  'Paris': [48.8566, 2.3522],
  'Lyon': [45.7640, 4.8357],
  'Marseille': [43.2965, 5.3698],
  'Nice': [43.7102, 7.2620],
  'Toulouse': [43.6047, 1.4442],
  'Bordeaux': [44.8378, -0.5792],
  'Strasbourg': [48.5734, 7.7521],
  'Nantes': [47.2184, -1.5536],
  'Montpellier': [43.6108, 3.8767],
  'Lille': [50.6292, 3.0573],
  'Nancy': [48.6921, 6.1844],
  'Grenoble': [45.1885, 5.7245],
  'Dijon': [47.3220, 5.0415],
  'Rouen': [49.4432, 1.0999],
  'Rennes': [48.1173, -1.6778],
  // United States
  'New York': [40.7128, -74.0060],
  'Los Angeles': [34.0522, -118.2437],
  'Chicago': [41.8781, -87.6298],
  'Houston': [29.7604, -95.3698],
  'Miami': [25.7617, -80.1918],
  'San Francisco': [37.7749, -122.4194],
  'Las Vegas': [36.1699, -115.1398],
  'Atlanta': [33.7490, -84.3880],
  'Dallas': [32.7767, -96.7970],
  'Phoenix': [33.4484, -112.0740],
  'Seattle': [47.6062, -122.3321],
  'Denver': [39.7392, -104.9903],
  'Boston': [42.3601, -71.0589],
  'Austin': [30.2672, -97.7431],
  'Nashville': [36.1627, -86.7816],
  'Portland': [45.5152, -122.6784],
  'San Diego': [32.7157, -117.1611],
  'Tampa': [27.9506, -82.4572],
  'Orlando': [28.5383, -81.3792],
  'Charlotte': [35.2271, -80.8431],
  // United Kingdom
  'London': [51.5074, -0.1278],
  'Manchester': [53.4808, -2.2426],
  'Birmingham': [52.4862, -1.8904],
  'Liverpool': [53.4084, -2.9916],
  'Leeds': [53.8008, -1.5491],
  'Glasgow': [55.8642, -4.2518],
  'Edinburgh': [55.9533, -3.1883],
  'Bristol': [51.4545, -2.5879],
  // Thailand
  'Bangkok': [13.7563, 100.5018],
  'Phuket': [7.8804, 98.3923],
  'Chiang Mai': [18.7883, 98.9853],
  'Pattaya': [12.9236, 100.8825],
  // Indonesia
  'Bali': [-8.3405, 115.0920],
  'Jakarta': [-6.2088, 106.8456],
  // China
  'Beijing': [39.9042, 116.4074],
  'Shanghai': [31.2304, 121.4737],
  'Shenzhen': [22.5431, 114.0579],
  'Hong Kong': [22.3193, 114.1694],
  'Guangzhou': [23.1291, 113.2644],
  // Pakistan
  'Lahore': [31.5204, 74.3587],
  'Karachi': [24.8607, 67.0011],
  'Islamabad': [33.6844, 73.0479],
  // India
  'Mumbai': [19.0760, 72.8777],
  'Delhi': [28.7041, 77.1025],
  'New Delhi': [28.6139, 77.2090],
  'Bangalore': [12.9716, 77.5946],
  'Hyderabad': [17.3850, 78.4867],
  // Brazil
  'São Paulo': [-23.5505, -46.6333],
  'Sao Paulo': [-23.5505, -46.6333],
  'Rio de Janeiro': [-22.9068, -43.1729],
  'Brasilia': [-15.7975, -47.8919],
  // Spain
  'Madrid': [40.4168, -3.7038],
  'Barcelona': [41.3874, 2.1686],
  'Valencia': [39.4699, -0.3763],
  'Seville': [37.3891, -5.9845],
  // Canada
  'Toronto': [43.6532, -79.3832],
  'Vancouver': [49.2827, -123.1207],
  'Montreal': [45.5017, -73.5673],
  'Ottawa': [45.4215, -75.6972],
  // UAE
  'Dubai': [25.2048, 55.2708],
  'Abu Dhabi': [24.4539, 54.3773],
  // Philippines
  'Manila': [14.5995, 120.9842],
  'Cebu': [10.3157, 123.8854],
  // Sweden
  'Stockholm': [59.3293, 18.0686],
  'Gothenburg': [57.7089, 11.9746],
  'Malmö': [55.6050, 13.0038],
  'Malmo': [55.6050, 13.0038],
  // South Korea
  'Seoul': [37.5665, 126.9780],
  'Busan': [35.1796, 129.0756],
  // Others
  'Buenos Aires': [-34.6037, -58.3816],
  'Sydney': [-33.8688, 151.2093],
  'Melbourne': [-37.8136, 144.9631],
  'Kuala Lumpur': [3.1390, 101.6869],
  'Kyiv': [50.4501, 30.5234],
  'Kiev': [50.4501, 30.5234],
  'Mexico City': [19.4326, -99.1332],
  'Lagos': [6.5244, 3.3792],
  'Johannesburg': [-26.2041, 28.0473],
  'Cape Town': [-33.9249, 18.4241],
  'Bogota': [4.7110, -74.0721],
  'Medellin': [6.2476, -75.5658],
  'Istanbul': [41.0082, 28.9784],
  'Moscow': [55.7558, 37.6173],
  'Amsterdam': [52.3676, 4.9041],
  'Berlin': [52.5200, 13.4050],
  'Munich': [48.1351, 11.5820],
  'Frankfurt': [50.1109, 8.6821],
  'Rome': [41.9028, 12.4964],
  'Milan': [45.4642, 9.1900],
  'Singapore': [1.3521, 103.8198],
  'Tokyo': [35.6762, 139.6503],
  'Ho Chi Minh City': [10.8231, 106.6297],
  'Hanoi': [21.0278, 105.8342],
  'Nairobi': [-1.2921, 36.8219],
  'Cairo': [30.0444, 31.2357],
  'Tel Aviv': [32.0853, 34.7818],
  'Jerusalem': [31.7683, 35.2137],
  'Lima': [-12.0464, -77.0428],
  'Santiago': [-33.4489, -70.6693],
  'Caracas': [10.4806, -66.9036],
  'San Jose': [9.9281, -84.0907],
  'Panama City': [8.9824, -79.5199],
  'Tegucigalpa': [14.0723, -87.1921],
};

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'United States': [39.8283, -98.5795],
  'France': [46.2276, 2.2137],
  'United Kingdom': [55.3781, -3.4360],
  'Thailand': [15.8700, 100.9925],
  'China': [35.8617, 104.1954],
  'Brazil': [-14.2350, -51.9253],
  'Canada': [56.1304, -106.3468],
  'India': [20.5937, 78.9629],
  'Spain': [40.4637, -3.7492],
  'Indonesia': [-0.7893, 113.9213],
  'UAE': [23.4241, 53.8478],
  'Philippines': [12.8797, 121.7740],
  'Sweden': [60.1282, 18.6435],
  'Argentina': [-38.4161, -63.6167],
  'Australia': [-25.2744, 133.7751],
  'South Korea': [35.9078, 127.7669],
  'Ukraine': [48.3794, 31.1656],
  'Malaysia': [4.2105, 101.9758],
  'Pakistan': [30.3753, 69.3451],
  'Mexico': [23.6345, -102.5528],
  'Nigeria': [9.0820, 8.6753],
  'South Africa': [-30.5595, 22.9375],
  'Colombia': [4.5709, -74.2973],
  'Turkey': [38.9637, 35.2433],
  'Russia': [61.5240, 105.3188],
  'Netherlands': [52.1326, 5.2913],
  'Germany': [51.1657, 10.4515],
  'Italy': [41.8719, 12.5674],
  'Singapore': [1.3521, 103.8198],
  'Japan': [36.2048, 138.2529],
  'Vietnam': [14.0583, 108.2772],
  'Israel': [31.0461, 34.8516],
  'Kenya': [-0.0236, 37.9062],
  'Ghana': [7.9465, -1.0232],
  'Egypt': [26.8206, 30.8025],
  'Taiwan': [23.6978, 120.9605],
  'Switzerland': [46.8182, 8.2275],
  'Norway': [60.4720, 8.4689],
  'Denmark': [56.2639, 9.5018],
  'Finland': [61.9241, 25.7482],
  'Poland': [51.9194, 19.1451],
  'Portugal': [39.3999, -8.2245],
  'Costa Rica': [9.7489, -83.7534],
  'Honduras': [15.2000, -86.2419],
  'Venezuela': [6.4238, -66.5897],
  'Chile': [-35.6751, -71.5430],
  'Peru': [-9.1900, -75.0152],
  'Panama': [8.5380, -80.7821],
  'El Salvador': [13.7942, -88.8965],
  'Jamaica': [18.1096, -77.2975],
  'Trinidad and Tobago': [10.6918, -61.2225],
  'Bangladesh': [23.6850, 90.3563],
  'Puerto Rico': [18.2208, -66.5901],
};

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
    'Nantes', 'Montpellier', 'Lille', 'Nancy', 'Grenoble', 'Dijon', 'Rouen', 'Rennes',
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

// ─── Coordinate Lookup ──────────────────────────────────────────────────────

/**
 * Get coordinates for a city or country with small random offset to prevent overlap.
 */
export function getCoordinates(country: string, city: string | null): { latitude: number; longitude: number } | null {
  let baseLat: number;
  let baseLng: number;

  if (city && CITY_COORDS[city]) {
    [baseLat, baseLng] = CITY_COORDS[city];
  } else if (COUNTRY_COORDS[country]) {
    [baseLat, baseLng] = COUNTRY_COORDS[country];
  } else {
    return null;
  }

  // Add small random offset (±0.3 degrees) to prevent exact overlap
  const latOffset = (Math.random() - 0.5) * 0.6;
  const lngOffset = (Math.random() - 0.5) * 0.6;

  return {
    latitude: Math.round((baseLat + latOffset) * 10000) / 10000,
    longitude: Math.round((baseLng + lngOffset) * 10000) / 10000,
  };
}

// ─── Parser Logic ────────────────────────────────────────────────────────────

/**
 * Extract geographic location (country, city, and coordinates) from text.
 * Uses keyword matching against predefined lists.
 */
export function parseGeoLocation(text: string): GeoLocation {
  const defaultResult: GeoLocation = { country: 'Unknown', city: null, latitude: null, longitude: null };

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

  const country = detectedCountry ?? 'Unknown';
  const coords = country !== 'Unknown' ? getCoordinates(country, detectedCity) : null;

  return {
    country,
    city: detectedCity,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
