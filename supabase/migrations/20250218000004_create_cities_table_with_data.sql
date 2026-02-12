-- Remove cities column from us_states (we'll use a proper relational table instead)
ALTER TABLE us_states DROP COLUMN IF EXISTS cities;

-- Create us_cities table
CREATE TABLE IF NOT EXISTS us_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state_id uuid NOT NULL REFERENCES us_states(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_us_cities_state_id ON us_cities(state_id);
CREATE INDEX IF NOT EXISTS idx_us_cities_name ON us_cities(name);

-- Enable RLS
ALTER TABLE us_cities ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to US cities
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE tablename = 'us_cities'
        AND policyname = 'Anyone can view US cities'
    ) THEN
        CREATE POLICY "Anyone can view US cities" ON us_cities FOR SELECT USING (true);
    END IF;
END
$$;

-- Add comment
COMMENT ON TABLE us_cities IS 'List of cities in the United States organized by state';

-- Insert cities for each state
-- Using state abbreviations to reference us_states table

-- Insert cities for Alabama (AL)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Birmingham',
  'Montgomery',
  'Mobile',
  'Huntsville',
  'Tuscaloosa',
  'Hoover',
  'Dothan',
  'Auburn',
  'Decatur',
  'Madison',
  'Florence',
  'Gadsden'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AL' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Alaska (AK)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Anchorage'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AK' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Arizona (AZ)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Phoenix',
  'Tucson',
  'Mesa',
  'Chandler',
  'Glendale',
  'Scottsdale',
  'Gilbert',
  'Tempe',
  'Peoria',
  'Surprise',
  'Yuma',
  'Avondale',
  'Goodyear',
  'Flagstaff',
  'Buckeye',
  'Lake Havasu City',
  'Casa Grande',
  'Sierra Vista',
  'Maricopa',
  'Oro Valley',
  'Prescott',
  'Bullhead City',
  'Prescott Valley',
  'Marana',
  'Apache Junction'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AZ' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Arkansas (AR)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Little Rock',
  'Fort Smith',
  'Fayetteville',
  'Springdale',
  'Jonesboro',
  'North Little Rock',
  'Conway',
  'Rogers',
  'Pine Bluff',
  'Bentonville'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AR' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for California (CA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Los Angeles',
  'San Diego',
  'San Jose',
  'San Francisco',
  'Fresno',
  'Sacramento',
  'Long Beach',
  'Oakland',
  'Bakersfield',
  'Anaheim',
  'Santa Ana',
  'Riverside',
  'Stockton',
  'Chula Vista',
  'Irvine',
  'Fremont',
  'San Bernardino',
  'Modesto',
  'Fontana',
  'Oxnard',
  'Moreno Valley',
  'Huntington Beach',
  'Glendale',
  'Santa Clarita',
  'Garden Grove',
  'Oceanside',
  'Rancho Cucamonga',
  'Santa Rosa',
  'Ontario',
  'Lancaster',
  'Elk Grove',
  'Corona',
  'Palmdale',
  'Salinas',
  'Pomona',
  'Hayward',
  'Escondido',
  'Torrance',
  'Sunnyvale',
  'Orange',
  'Fullerton',
  'Pasadena',
  'Thousand Oaks',
  'Visalia',
  'Simi Valley',
  'Concord',
  'Roseville',
  'Victorville',
  'Santa Clara',
  'Vallejo',
  'Berkeley',
  'El Monte',
  'Downey',
  'Costa Mesa',
  'Inglewood',
  'Carlsbad',
  'San Buenaventura (Ventura)',
  'Fairfield',
  'West Covina',
  'Murrieta',
  'Richmond',
  'Norwalk',
  'Antioch',
  'Temecula',
  'Burbank',
  'Daly City',
  'Rialto',
  'Santa Maria',
  'El Cajon',
  'San Mateo',
  'Clovis',
  'Compton',
  'Jurupa Valley',
  'Vista',
  'South Gate',
  'Mission Viejo',
  'Vacaville',
  'Carson',
  'Hesperia',
  'Santa Monica',
  'Westminster',
  'Redding',
  'Santa Barbara',
  'Chico',
  'Newport Beach',
  'San Leandro',
  'San Marcos',
  'Whittier',
  'Hawthorne',
  'Citrus Heights',
  'Tracy',
  'Alhambra',
  'Livermore',
  'Buena Park',
  'Menifee',
  'Hemet',
  'Lakewood',
  'Merced',
  'Chino',
  'Indio',
  'Redwood City',
  'Lake Forest',
  'Napa',
  'Tustin',
  'Bellflower',
  'Mountain View',
  'Chino Hills',
  'Baldwin Park',
  'Alameda',
  'Upland',
  'San Ramon',
  'Folsom',
  'Pleasanton',
  'Union City',
  'Perris',
  'Manteca',
  'Lynwood',
  'Apple Valley',
  'Redlands',
  'Turlock',
  'Milpitas',
  'Redondo Beach',
  'Rancho Cordova',
  'Yorba Linda',
  'Palo Alto',
  'Davis',
  'Camarillo',
  'Walnut Creek',
  'Pittsburg',
  'South San Francisco',
  'Yuba City',
  'San Clemente',
  'Laguna Niguel',
  'Pico Rivera',
  'Montebello',
  'Lodi',
  'Madera',
  'Santa Cruz',
  'La Habra',
  'Encinitas',
  'Monterey Park',
  'Tulare',
  'Cupertino',
  'Gardena',
  'National City',
  'Rocklin',
  'Petaluma',
  'Huntington Park',
  'San Rafael',
  'La Mesa',
  'Arcadia',
  'Fountain Valley',
  'Diamond Bar',
  'Woodland',
  'Santee',
  'Lake Elsinore',
  'Porterville',
  'Paramount',
  'Eastvale',
  'Rosemead',
  'Hanford',
  'Highland',
  'Brentwood',
  'Novato',
  'Colton',
  'Cathedral City',
  'Delano',
  'Yucaipa',
  'Watsonville',
  'Placentia',
  'Glendora',
  'Gilroy',
  'Palm Desert',
  'Cerritos',
  'West Sacramento',
  'Aliso Viejo',
  'Poway',
  'La Mirada',
  'Rancho Santa Margarita',
  'Cypress',
  'Dublin',
  'Covina',
  'Azusa',
  'Palm Springs',
  'San Luis Obispo',
  'Ceres',
  'San Jacinto',
  'Lincoln',
  'Newark',
  'Lompoc',
  'El Centro',
  'Danville',
  'Bell Gardens',
  'Coachella',
  'Rancho Palos Verdes',
  'San Bruno',
  'Rohnert Park',
  'Brea',
  'La Puente',
  'Campbell',
  'San Gabriel',
  'Beaumont',
  'Morgan Hill',
  'Culver City',
  'Calexico',
  'Stanton',
  'La Quinta',
  'Pacifica',
  'Montclair',
  'Oakley',
  'Monrovia',
  'Los Banos',
  'Martinez'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Colorado (CO)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Denver',
  'Colorado Springs',
  'Aurora',
  'Fort Collins',
  'Lakewood',
  'Thornton',
  'Arvada',
  'Westminster',
  'Pueblo',
  'Centennial',
  'Boulder',
  'Greeley',
  'Longmont',
  'Loveland',
  'Grand Junction',
  'Broomfield',
  'Castle Rock',
  'Commerce City',
  'Parker',
  'Littleton',
  'Northglenn'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CO' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Connecticut (CT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Bridgeport',
  'New Haven',
  'Stamford',
  'Hartford',
  'Waterbury',
  'Norwalk',
  'Danbury',
  'New Britain',
  'Meriden',
  'Bristol',
  'West Haven',
  'Milford',
  'Middletown',
  'Norwich',
  'Shelton'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Delaware (DE)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Wilmington',
  'Dover'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'DE' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Florida (FL)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Jacksonville',
  'Miami',
  'Tampa',
  'Orlando',
  'St. Petersburg',
  'Hialeah',
  'Tallahassee',
  'Fort Lauderdale',
  'Port St. Lucie',
  'Cape Coral',
  'Pembroke Pines',
  'Hollywood',
  'Miramar',
  'Gainesville',
  'Coral Springs',
  'Miami Gardens',
  'Clearwater',
  'Palm Bay',
  'Pompano Beach',
  'West Palm Beach',
  'Lakeland',
  'Davie',
  'Miami Beach',
  'Sunrise',
  'Plantation',
  'Boca Raton',
  'Deltona',
  'Largo',
  'Deerfield Beach',
  'Palm Coast',
  'Melbourne',
  'Boynton Beach',
  'Lauderhill',
  'Weston',
  'Fort Myers',
  'Kissimmee',
  'Homestead',
  'Tamarac',
  'Delray Beach',
  'Daytona Beach',
  'North Miami',
  'Wellington',
  'North Port',
  'Jupiter',
  'Ocala',
  'Port Orange',
  'Margate',
  'Coconut Creek',
  'Sanford',
  'Sarasota',
  'Pensacola',
  'Bradenton',
  'Palm Beach Gardens',
  'Pinellas Park',
  'Coral Gables',
  'Doral',
  'Bonita Springs',
  'Apopka',
  'Titusville',
  'North Miami Beach',
  'Oakland Park',
  'Fort Pierce',
  'North Lauderdale',
  'Cutler Bay',
  'Altamonte Springs',
  'St. Cloud',
  'Greenacres',
  'Ormond Beach',
  'Ocoee',
  'Hallandale Beach',
  'Winter Garden',
  'Aventura'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'FL' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Georgia (GA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Atlanta',
  'Columbus',
  'Augusta-Richmond County',
  'Savannah',
  'Athens-Clarke County',
  'Sandy Springs',
  'Roswell',
  'Macon',
  'Johns Creek',
  'Albany',
  'Warner Robins',
  'Alpharetta',
  'Marietta',
  'Valdosta',
  'Smyrna',
  'Dunwoody'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'GA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Hawaii (HI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Honolulu'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'HI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Idaho (ID)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Boise City',
  'Nampa',
  'Meridian',
  'Idaho Falls',
  'Pocatello',
  'Caldwell',
  'Coeur d''Alene',
  'Twin Falls'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ID' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Illinois (IL)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Chicago',
  'Aurora',
  'Rockford',
  'Joliet',
  'Naperville',
  'Springfield',
  'Peoria',
  'Elgin',
  'Waukegan',
  'Cicero',
  'Champaign',
  'Bloomington',
  'Arlington Heights',
  'Evanston',
  'Decatur',
  'Schaumburg',
  'Bolingbrook',
  'Palatine',
  'Skokie',
  'Des Plaines',
  'Orland Park',
  'Tinley Park',
  'Oak Lawn',
  'Berwyn',
  'Mount Prospect',
  'Normal',
  'Wheaton',
  'Hoffman Estates',
  'Oak Park',
  'Downers Grove',
  'Elmhurst',
  'Glenview',
  'DeKalb',
  'Lombard',
  'Belleville',
  'Moline',
  'Buffalo Grove',
  'Bartlett',
  'Urbana',
  'Quincy',
  'Crystal Lake',
  'Plainfield',
  'Streamwood',
  'Carol Stream',
  'Romeoville',
  'Rock Island',
  'Hanover Park',
  'Carpentersville',
  'Wheeling',
  'Park Ridge',
  'Addison',
  'Calumet City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IL' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Indiana (IN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Indianapolis',
  'Fort Wayne',
  'Evansville',
  'South Bend',
  'Carmel',
  'Bloomington',
  'Fishers',
  'Hammond',
  'Gary',
  'Muncie',
  'Lafayette',
  'Terre Haute',
  'Kokomo',
  'Anderson',
  'Noblesville',
  'Greenwood',
  'Elkhart',
  'Mishawaka',
  'Lawrence',
  'Jeffersonville',
  'Columbus',
  'Portage'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IN' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Iowa (IA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Des Moines',
  'Cedar Rapids',
  'Davenport',
  'Sioux City',
  'Iowa City',
  'Waterloo',
  'Council Bluffs',
  'Ames',
  'West Des Moines',
  'Dubuque',
  'Ankeny',
  'Urbandale',
  'Cedar Falls'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Kansas (KS)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Wichita',
  'Overland Park',
  'Kansas City',
  'Olathe',
  'Topeka',
  'Lawrence',
  'Shawnee',
  'Manhattan',
  'Lenexa',
  'Salina',
  'Hutchinson'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'KS' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Kentucky (KY)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Louisville/Jefferson County',
  'Lexington-Fayette',
  'Bowling Green',
  'Owensboro',
  'Covington'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'KY' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Louisiana (LA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'New Orleans',
  'Baton Rouge',
  'Shreveport',
  'Lafayette',
  'Lake Charles',
  'Kenner',
  'Bossier City',
  'Monroe',
  'Alexandria'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'LA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Maine (ME)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Portland'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ME' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Maryland (MD)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Baltimore',
  'Frederick',
  'Rockville',
  'Gaithersburg',
  'Bowie',
  'Hagerstown',
  'Annapolis'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MD' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Massachusetts (MA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Boston',
  'Worcester',
  'Springfield',
  'Lowell',
  'Cambridge',
  'New Bedford',
  'Brockton',
  'Quincy',
  'Lynn',
  'Fall River',
  'Newton',
  'Lawrence',
  'Somerville',
  'Waltham',
  'Haverhill',
  'Malden',
  'Medford',
  'Taunton',
  'Chicopee',
  'Weymouth Town',
  'Revere',
  'Peabody',
  'Methuen',
  'Barnstable Town',
  'Pittsfield',
  'Attleboro',
  'Everett',
  'Salem',
  'Westfield',
  'Leominster',
  'Fitchburg',
  'Beverly',
  'Holyoke',
  'Marlborough',
  'Woburn',
  'Chelsea'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Michigan (MI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Detroit',
  'Grand Rapids',
  'Warren',
  'Sterling Heights',
  'Ann Arbor',
  'Lansing',
  'Flint',
  'Dearborn',
  'Livonia',
  'Westland',
  'Troy',
  'Farmington Hills',
  'Kalamazoo',
  'Wyoming',
  'Southfield',
  'Rochester Hills',
  'Taylor',
  'Pontiac',
  'St. Clair Shores',
  'Royal Oak',
  'Novi',
  'Dearborn Heights',
  'Battle Creek',
  'Saginaw',
  'Kentwood',
  'East Lansing',
  'Roseville',
  'Portage',
  'Midland',
  'Lincoln Park',
  'Muskegon'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Minnesota (MN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Minneapolis',
  'St. Paul',
  'Rochester',
  'Duluth',
  'Bloomington',
  'Brooklyn Park',
  'Plymouth',
  'St. Cloud',
  'Eagan',
  'Woodbury',
  'Maple Grove',
  'Eden Prairie',
  'Coon Rapids',
  'Burnsville',
  'Blaine',
  'Lakeville',
  'Minnetonka',
  'Apple Valley',
  'Edina',
  'St. Louis Park',
  'Mankato',
  'Maplewood',
  'Moorhead',
  'Shakopee'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MN' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Mississippi (MS)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Jackson',
  'Gulfport',
  'Southaven',
  'Hattiesburg',
  'Biloxi',
  'Meridian'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MS' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Missouri (MO)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Kansas City',
  'St. Louis',
  'Springfield',
  'Independence',
  'Columbia',
  'Lee''s Summit',
  'O''Fallon',
  'St. Joseph',
  'St. Charles',
  'St. Peters',
  'Blue Springs',
  'Florissant',
  'Joplin',
  'Chesterfield',
  'Jefferson City',
  'Cape Girardeau'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MO' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Montana (MT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Billings',
  'Missoula',
  'Great Falls',
  'Bozeman'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Nebraska (NE)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Omaha',
  'Lincoln',
  'Bellevue',
  'Grand Island'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NE' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Nevada (NV)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Las Vegas',
  'Henderson',
  'Reno',
  'North Las Vegas',
  'Sparks',
  'Carson City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NV' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New Hampshire (NH)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Manchester',
  'Nashua',
  'Concord'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NH' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New Jersey (NJ)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Newark',
  'Jersey City',
  'Paterson',
  'Elizabeth',
  'Clifton',
  'Trenton',
  'Camden',
  'Passaic',
  'Union City',
  'Bayonne',
  'East Orange',
  'Vineland',
  'New Brunswick',
  'Hoboken',
  'Perth Amboy',
  'West New York',
  'Plainfield',
  'Hackensack',
  'Sayreville',
  'Kearny',
  'Linden',
  'Atlantic City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NJ' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New Mexico (NM)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Albuquerque',
  'Las Cruces',
  'Rio Rancho',
  'Santa Fe',
  'Roswell',
  'Farmington',
  'Clovis'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NM' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New York (NY)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'New York',
  'Buffalo',
  'Rochester',
  'Yonkers',
  'Syracuse',
  'Albany',
  'New Rochelle',
  'Mount Vernon',
  'Schenectady',
  'Utica',
  'White Plains',
  'Hempstead',
  'Troy',
  'Niagara Falls',
  'Binghamton',
  'Freeport',
  'Valley Stream'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NY' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for North Carolina (NC)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Charlotte',
  'Raleigh',
  'Greensboro',
  'Durham',
  'Winston-Salem',
  'Fayetteville',
  'Cary',
  'Wilmington',
  'High Point',
  'Greenville',
  'Asheville',
  'Concord',
  'Gastonia',
  'Jacksonville',
  'Chapel Hill',
  'Rocky Mount',
  'Burlington',
  'Wilson',
  'Huntersville',
  'Kannapolis',
  'Apex',
  'Hickory',
  'Goldsboro'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NC' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for North Dakota (ND)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Fargo',
  'Bismarck',
  'Grand Forks',
  'Minot'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ND' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Ohio (OH)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Columbus',
  'Cleveland',
  'Cincinnati',
  'Toledo',
  'Akron',
  'Dayton',
  'Parma',
  'Canton',
  'Youngstown',
  'Lorain',
  'Hamilton',
  'Springfield',
  'Kettering',
  'Elyria',
  'Lakewood',
  'Cuyahoga Falls',
  'Middletown',
  'Euclid',
  'Newark',
  'Mansfield',
  'Mentor',
  'Beavercreek',
  'Cleveland Heights',
  'Strongsville',
  'Dublin',
  'Fairfield',
  'Findlay',
  'Warren',
  'Lancaster',
  'Lima',
  'Huber Heights',
  'Westerville',
  'Marion',
  'Grove City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OH' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Oklahoma (OK)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Oklahoma City',
  'Tulsa',
  'Norman',
  'Broken Arrow',
  'Lawton',
  'Edmond',
  'Moore',
  'Midwest City',
  'Enid',
  'Stillwater',
  'Muskogee'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OK' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Oregon (OR)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Portland',
  'Eugene',
  'Salem',
  'Gresham',
  'Hillsboro',
  'Beaverton',
  'Bend',
  'Medford',
  'Springfield',
  'Corvallis',
  'Albany',
  'Tigard',
  'Lake Oswego',
  'Keizer'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OR' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Pennsylvania (PA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Philadelphia',
  'Pittsburgh',
  'Allentown',
  'Erie',
  'Reading',
  'Scranton',
  'Bethlehem',
  'Lancaster',
  'Harrisburg',
  'Altoona',
  'York',
  'State College',
  'Wilkes-Barre'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'PA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Rhode Island (RI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Providence',
  'Warwick',
  'Cranston',
  'Pawtucket',
  'East Providence',
  'Woonsocket'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'RI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for South Carolina (SC)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Columbia',
  'Charleston',
  'North Charleston',
  'Mount Pleasant',
  'Rock Hill',
  'Greenville',
  'Summerville',
  'Sumter',
  'Goose Creek',
  'Hilton Head Island',
  'Florence',
  'Spartanburg'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'SC' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for South Dakota (SD)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Sioux Falls',
  'Rapid City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'SD' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Tennessee (TN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Memphis',
  'Nashville-Davidson',
  'Knoxville',
  'Chattanooga',
  'Clarksville',
  'Murfreesboro',
  'Jackson',
  'Franklin',
  'Johnson City',
  'Bartlett',
  'Hendersonville',
  'Kingsport',
  'Collierville',
  'Cleveland',
  'Smyrna',
  'Germantown',
  'Brentwood'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'TN' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Texas (TX)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Houston',
  'San Antonio',
  'Dallas',
  'Austin',
  'Fort Worth',
  'El Paso',
  'Arlington',
  'Corpus Christi',
  'Plano',
  'Laredo',
  'Lubbock',
  'Garland',
  'Irving',
  'Amarillo',
  'Grand Prairie',
  'Brownsville',
  'Pasadena',
  'McKinney',
  'Mesquite',
  'McAllen',
  'Killeen',
  'Frisco',
  'Waco',
  'Carrollton',
  'Denton',
  'Midland',
  'Abilene',
  'Beaumont',
  'Round Rock',
  'Odessa',
  'Wichita Falls',
  'Richardson',
  'Lewisville',
  'Tyler',
  'College Station',
  'Pearland',
  'San Angelo',
  'Allen',
  'League City',
  'Sugar Land',
  'Longview',
  'Edinburg',
  'Mission',
  'Bryan',
  'Baytown',
  'Pharr',
  'Temple',
  'Missouri City',
  'Flower Mound',
  'Harlingen',
  'North Richland Hills',
  'Victoria',
  'Conroe',
  'New Braunfels',
  'Mansfield',
  'Cedar Park',
  'Rowlett',
  'Port Arthur',
  'Euless',
  'Georgetown',
  'Pflugerville',
  'DeSoto',
  'San Marcos',
  'Grapevine',
  'Bedford',
  'Galveston',
  'Cedar Hill',
  'Texas City',
  'Wylie',
  'Haltom City',
  'Keller',
  'Coppell',
  'Rockwall',
  'Huntsville',
  'Duncanville',
  'Sherman',
  'The Colony',
  'Burleson',
  'Hurst',
  'Lancaster',
  'Texarkana',
  'Friendswood',
  'Weslaco'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'TX' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Utah (UT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Salt Lake City',
  'West Valley City',
  'Provo',
  'West Jordan',
  'Orem',
  'Sandy',
  'Ogden',
  'St. George',
  'Layton',
  'Taylorsville',
  'South Jordan',
  'Lehi',
  'Logan',
  'Murray',
  'Draper',
  'Bountiful',
  'Riverton',
  'Roy'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'UT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Vermont (VT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Burlington'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'VT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Virginia (VA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Virginia Beach',
  'Norfolk',
  'Chesapeake',
  'Richmond',
  'Newport News',
  'Alexandria',
  'Hampton',
  'Roanoke',
  'Portsmouth',
  'Suffolk',
  'Lynchburg',
  'Harrisonburg',
  'Leesburg',
  'Charlottesville',
  'Danville',
  'Blacksburg',
  'Manassas'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'VA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Washington (WA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Seattle',
  'Spokane',
  'Tacoma',
  'Vancouver',
  'Bellevue',
  'Kent',
  'Everett',
  'Renton',
  'Yakima',
  'Federal Way',
  'Spokane Valley',
  'Bellingham',
  'Kennewick',
  'Auburn',
  'Pasco',
  'Marysville',
  'Lakewood',
  'Redmond',
  'Shoreline',
  'Richland',
  'Kirkland',
  'Burien',
  'Sammamish',
  'Olympia',
  'Lacey',
  'Edmonds',
  'Bremerton',
  'Puyallup'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for West Virginia (WV)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Charleston',
  'Huntington'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WV' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Wisconsin (WI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Milwaukee',
  'Madison',
  'Green Bay',
  'Kenosha',
  'Racine',
  'Appleton',
  'Waukesha',
  'Eau Claire',
  'Oshkosh',
  'Janesville',
  'West Allis',
  'La Crosse',
  'Sheboygan',
  'Wauwatosa',
  'Fond du Lac',
  'New Berlin',
  'Wausau',
  'Brookfield',
  'Greenfield',
  'Beloit'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Wyoming (WY)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Cheyenne',
  'Casper',
  'Gillette',
  'Laramie',
  'Rock Springs',
  'Sheridan',
  'Evanston',
  'Green River',
  'Riverton',
  'Jackson',
  'Cody',
  'Rawlins',
  'Lander',
  'Powell',
  'Douglas',
  'Torrington',
  'Worland',
  'Buffalo',
  'Mills',
  'Thermopolis',
  'Glenrock',
  'Lovell',
  'Kemmerer',
  'Afton',
  'Lyman',
  'Pinedale',
  'Saratoga',
  'Greybull',
  'Wright',
  'Wheatland',
  'Newcastle',
  'Evansville',
  'Alpine',
  'Lusk',
  'Basin',
  'Meeteetse',
  'Dubois',
  'Sinclair',
  'Hulett',
  'Sundance',
  'Pine Bluffs',
  'Guernsey',
  'Moorcroft',
  'Upton',
  'Cowley',
  'Marbleton',
  'Dayton',
  'Hanna',
  'Byron',
  'Diamondville',
  'Ranchester',
  'LaGrange',
  'Mountain View',
  'Wilson',
  'Teton Village',
  'Story',
  'Centennial'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WY' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for each state
-- Using state abbreviations to reference us_states table

-- Insert cities for Alabama (AL)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Birmingham',
  'Montgomery',
  'Mobile',
  'Huntsville',
  'Tuscaloosa',
  'Hoover',
  'Dothan',
  'Auburn',
  'Decatur',
  'Madison',
  'Florence',
  'Gadsden'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AL' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Alaska (AK)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Anchorage'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AK' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Arizona (AZ)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Phoenix',
  'Tucson',
  'Mesa',
  'Chandler',
  'Glendale',
  'Scottsdale',
  'Gilbert',
  'Tempe',
  'Peoria',
  'Surprise',
  'Yuma',
  'Avondale',
  'Goodyear',
  'Flagstaff',
  'Buckeye',
  'Lake Havasu City',
  'Casa Grande',
  'Sierra Vista',
  'Maricopa',
  'Oro Valley',
  'Prescott',
  'Bullhead City',
  'Prescott Valley',
  'Marana',
  'Apache Junction'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AZ' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Arkansas (AR)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Little Rock',
  'Fort Smith',
  'Fayetteville',
  'Springdale',
  'Jonesboro',
  'North Little Rock',
  'Conway',
  'Rogers',
  'Pine Bluff',
  'Bentonville'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AR' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for California (CA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Los Angeles',
  'San Diego',
  'San Jose',
  'San Francisco',
  'Fresno',
  'Sacramento',
  'Long Beach',
  'Oakland',
  'Bakersfield',
  'Anaheim',
  'Santa Ana',
  'Riverside',
  'Stockton',
  'Chula Vista',
  'Irvine',
  'Fremont',
  'San Bernardino',
  'Modesto',
  'Fontana',
  'Oxnard',
  'Moreno Valley',
  'Huntington Beach',
  'Glendale',
  'Santa Clarita',
  'Garden Grove',
  'Oceanside',
  'Rancho Cucamonga',
  'Santa Rosa',
  'Ontario',
  'Lancaster',
  'Elk Grove',
  'Corona',
  'Palmdale',
  'Salinas',
  'Pomona',
  'Hayward',
  'Escondido',
  'Torrance',
  'Sunnyvale',
  'Orange',
  'Fullerton',
  'Pasadena',
  'Thousand Oaks',
  'Visalia',
  'Simi Valley',
  'Concord',
  'Roseville',
  'Victorville',
  'Santa Clara',
  'Vallejo',
  'Berkeley',
  'El Monte',
  'Downey',
  'Costa Mesa',
  'Inglewood',
  'Carlsbad',
  'San Buenaventura (Ventura)',
  'Fairfield',
  'West Covina',
  'Murrieta',
  'Richmond',
  'Norwalk',
  'Antioch',
  'Temecula',
  'Burbank',
  'Daly City',
  'Rialto',
  'Santa Maria',
  'El Cajon',
  'San Mateo',
  'Clovis',
  'Compton',
  'Jurupa Valley',
  'Vista',
  'South Gate',
  'Mission Viejo',
  'Vacaville',
  'Carson',
  'Hesperia',
  'Santa Monica',
  'Westminster',
  'Redding',
  'Santa Barbara',
  'Chico',
  'Newport Beach',
  'San Leandro',
  'San Marcos',
  'Whittier',
  'Hawthorne',
  'Citrus Heights',
  'Tracy',
  'Alhambra',
  'Livermore',
  'Buena Park',
  'Menifee',
  'Hemet',
  'Lakewood',
  'Merced',
  'Chino',
  'Indio',
  'Redwood City',
  'Lake Forest',
  'Napa',
  'Tustin',
  'Bellflower',
  'Mountain View',
  'Chino Hills',
  'Baldwin Park',
  'Alameda',
  'Upland',
  'San Ramon',
  'Folsom',
  'Pleasanton',
  'Union City',
  'Perris',
  'Manteca',
  'Lynwood',
  'Apple Valley',
  'Redlands',
  'Turlock',
  'Milpitas',
  'Redondo Beach',
  'Rancho Cordova',
  'Yorba Linda',
  'Palo Alto',
  'Davis',
  'Camarillo',
  'Walnut Creek',
  'Pittsburg',
  'South San Francisco',
  'Yuba City',
  'San Clemente',
  'Laguna Niguel',
  'Pico Rivera',
  'Montebello',
  'Lodi',
  'Madera',
  'Santa Cruz',
  'La Habra',
  'Encinitas',
  'Monterey Park',
  'Tulare',
  'Cupertino',
  'Gardena',
  'National City',
  'Rocklin',
  'Petaluma',
  'Huntington Park',
  'San Rafael',
  'La Mesa',
  'Arcadia',
  'Fountain Valley',
  'Diamond Bar',
  'Woodland',
  'Santee',
  'Lake Elsinore',
  'Porterville',
  'Paramount',
  'Eastvale',
  'Rosemead',
  'Hanford',
  'Highland',
  'Brentwood',
  'Novato',
  'Colton',
  'Cathedral City',
  'Delano',
  'Yucaipa',
  'Watsonville',
  'Placentia',
  'Glendora',
  'Gilroy',
  'Palm Desert',
  'Cerritos',
  'West Sacramento',
  'Aliso Viejo',
  'Poway',
  'La Mirada',
  'Rancho Santa Margarita',
  'Cypress',
  'Dublin',
  'Covina',
  'Azusa',
  'Palm Springs',
  'San Luis Obispo',
  'Ceres',
  'San Jacinto',
  'Lincoln',
  'Newark',
  'Lompoc',
  'El Centro',
  'Danville',
  'Bell Gardens',
  'Coachella',
  'Rancho Palos Verdes',
  'San Bruno',
  'Rohnert Park',
  'Brea',
  'La Puente',
  'Campbell',
  'San Gabriel',
  'Beaumont',
  'Morgan Hill',
  'Culver City',
  'Calexico',
  'Stanton',
  'La Quinta',
  'Pacifica',
  'Montclair',
  'Oakley',
  'Monrovia',
  'Los Banos',
  'Martinez'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Colorado (CO)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Denver',
  'Colorado Springs',
  'Aurora',
  'Fort Collins',
  'Lakewood',
  'Thornton',
  'Arvada',
  'Westminster',
  'Pueblo',
  'Centennial',
  'Boulder',
  'Greeley',
  'Longmont',
  'Loveland',
  'Grand Junction',
  'Broomfield',
  'Castle Rock',
  'Commerce City',
  'Parker',
  'Littleton',
  'Northglenn'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CO' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Connecticut (CT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Bridgeport',
  'New Haven',
  'Stamford',
  'Hartford',
  'Waterbury',
  'Norwalk',
  'Danbury',
  'New Britain',
  'Meriden',
  'Bristol',
  'West Haven',
  'Milford',
  'Middletown',
  'Norwich',
  'Shelton'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Delaware (DE)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Wilmington',
  'Dover'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'DE' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Florida (FL)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Jacksonville',
  'Miami',
  'Tampa',
  'Orlando',
  'St. Petersburg',
  'Hialeah',
  'Tallahassee',
  'Fort Lauderdale',
  'Port St. Lucie',
  'Cape Coral',
  'Pembroke Pines',
  'Hollywood',
  'Miramar',
  'Gainesville',
  'Coral Springs',
  'Miami Gardens',
  'Clearwater',
  'Palm Bay',
  'Pompano Beach',
  'West Palm Beach',
  'Lakeland',
  'Davie',
  'Miami Beach',
  'Sunrise',
  'Plantation',
  'Boca Raton',
  'Deltona',
  'Largo',
  'Deerfield Beach',
  'Palm Coast',
  'Melbourne',
  'Boynton Beach',
  'Lauderhill',
  'Weston',
  'Fort Myers',
  'Kissimmee',
  'Homestead',
  'Tamarac',
  'Delray Beach',
  'Daytona Beach',
  'North Miami',
  'Wellington',
  'North Port',
  'Jupiter',
  'Ocala',
  'Port Orange',
  'Margate',
  'Coconut Creek',
  'Sanford',
  'Sarasota',
  'Pensacola',
  'Bradenton',
  'Palm Beach Gardens',
  'Pinellas Park',
  'Coral Gables',
  'Doral',
  'Bonita Springs',
  'Apopka',
  'Titusville',
  'North Miami Beach',
  'Oakland Park',
  'Fort Pierce',
  'North Lauderdale',
  'Cutler Bay',
  'Altamonte Springs',
  'St. Cloud',
  'Greenacres',
  'Ormond Beach',
  'Ocoee',
  'Hallandale Beach',
  'Winter Garden',
  'Aventura'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'FL' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Georgia (GA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Atlanta',
  'Columbus',
  'Augusta-Richmond County',
  'Savannah',
  'Athens-Clarke County',
  'Sandy Springs',
  'Roswell',
  'Macon',
  'Johns Creek',
  'Albany',
  'Warner Robins',
  'Alpharetta',
  'Marietta',
  'Valdosta',
  'Smyrna',
  'Dunwoody'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'GA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Hawaii (HI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Honolulu'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'HI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Idaho (ID)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Boise City',
  'Nampa',
  'Meridian',
  'Idaho Falls',
  'Pocatello',
  'Caldwell',
  'Coeur d''Alene',
  'Twin Falls'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ID' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Illinois (IL)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Chicago',
  'Aurora',
  'Rockford',
  'Joliet',
  'Naperville',
  'Springfield',
  'Peoria',
  'Elgin',
  'Waukegan',
  'Cicero',
  'Champaign',
  'Bloomington',
  'Arlington Heights',
  'Evanston',
  'Decatur',
  'Schaumburg',
  'Bolingbrook',
  'Palatine',
  'Skokie',
  'Des Plaines',
  'Orland Park',
  'Tinley Park',
  'Oak Lawn',
  'Berwyn',
  'Mount Prospect',
  'Normal',
  'Wheaton',
  'Hoffman Estates',
  'Oak Park',
  'Downers Grove',
  'Elmhurst',
  'Glenview',
  'DeKalb',
  'Lombard',
  'Belleville',
  'Moline',
  'Buffalo Grove',
  'Bartlett',
  'Urbana',
  'Quincy',
  'Crystal Lake',
  'Plainfield',
  'Streamwood',
  'Carol Stream',
  'Romeoville',
  'Rock Island',
  'Hanover Park',
  'Carpentersville',
  'Wheeling',
  'Park Ridge',
  'Addison',
  'Calumet City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IL' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Indiana (IN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Indianapolis',
  'Fort Wayne',
  'Evansville',
  'South Bend',
  'Carmel',
  'Bloomington',
  'Fishers',
  'Hammond',
  'Gary',
  'Muncie',
  'Lafayette',
  'Terre Haute',
  'Kokomo',
  'Anderson',
  'Noblesville',
  'Greenwood',
  'Elkhart',
  'Mishawaka',
  'Lawrence',
  'Jeffersonville',
  'Columbus',
  'Portage'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IN' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Iowa (IA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Des Moines',
  'Cedar Rapids',
  'Davenport',
  'Sioux City',
  'Iowa City',
  'Waterloo',
  'Council Bluffs',
  'Ames',
  'West Des Moines',
  'Dubuque',
  'Ankeny',
  'Urbandale',
  'Cedar Falls'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Kansas (KS)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Wichita',
  'Overland Park',
  'Kansas City',
  'Olathe',
  'Topeka',
  'Lawrence',
  'Shawnee',
  'Manhattan',
  'Lenexa',
  'Salina',
  'Hutchinson'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'KS' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Kentucky (KY)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Louisville/Jefferson County',
  'Lexington-Fayette',
  'Bowling Green',
  'Owensboro',
  'Covington'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'KY' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Louisiana (LA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'New Orleans',
  'Baton Rouge',
  'Shreveport',
  'Lafayette',
  'Lake Charles',
  'Kenner',
  'Bossier City',
  'Monroe',
  'Alexandria'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'LA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Maine (ME)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Portland'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ME' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Maryland (MD)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Baltimore',
  'Frederick',
  'Rockville',
  'Gaithersburg',
  'Bowie',
  'Hagerstown',
  'Annapolis'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MD' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Massachusetts (MA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Boston',
  'Worcester',
  'Springfield',
  'Lowell',
  'Cambridge',
  'New Bedford',
  'Brockton',
  'Quincy',
  'Lynn',
  'Fall River',
  'Newton',
  'Lawrence',
  'Somerville',
  'Waltham',
  'Haverhill',
  'Malden',
  'Medford',
  'Taunton',
  'Chicopee',
  'Weymouth Town',
  'Revere',
  'Peabody',
  'Methuen',
  'Barnstable Town',
  'Pittsfield',
  'Attleboro',
  'Everett',
  'Salem',
  'Westfield',
  'Leominster',
  'Fitchburg',
  'Beverly',
  'Holyoke',
  'Marlborough',
  'Woburn',
  'Chelsea'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Michigan (MI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Detroit',
  'Grand Rapids',
  'Warren',
  'Sterling Heights',
  'Ann Arbor',
  'Lansing',
  'Flint',
  'Dearborn',
  'Livonia',
  'Westland',
  'Troy',
  'Farmington Hills',
  'Kalamazoo',
  'Wyoming',
  'Southfield',
  'Rochester Hills',
  'Taylor',
  'Pontiac',
  'St. Clair Shores',
  'Royal Oak',
  'Novi',
  'Dearborn Heights',
  'Battle Creek',
  'Saginaw',
  'Kentwood',
  'East Lansing',
  'Roseville',
  'Portage',
  'Midland',
  'Lincoln Park',
  'Muskegon'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Minnesota (MN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Minneapolis',
  'St. Paul',
  'Rochester',
  'Duluth',
  'Bloomington',
  'Brooklyn Park',
  'Plymouth',
  'St. Cloud',
  'Eagan',
  'Woodbury',
  'Maple Grove',
  'Eden Prairie',
  'Coon Rapids',
  'Burnsville',
  'Blaine',
  'Lakeville',
  'Minnetonka',
  'Apple Valley',
  'Edina',
  'St. Louis Park',
  'Mankato',
  'Maplewood',
  'Moorhead',
  'Shakopee'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MN' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Mississippi (MS)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Jackson',
  'Gulfport',
  'Southaven',
  'Hattiesburg',
  'Biloxi',
  'Meridian'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MS' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Missouri (MO)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Kansas City',
  'St. Louis',
  'Springfield',
  'Independence',
  'Columbia',
  'Lee''s Summit',
  'O''Fallon',
  'St. Joseph',
  'St. Charles',
  'St. Peters',
  'Blue Springs',
  'Florissant',
  'Joplin',
  'Chesterfield',
  'Jefferson City',
  'Cape Girardeau'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MO' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Montana (MT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Billings',
  'Missoula',
  'Great Falls',
  'Bozeman'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Nebraska (NE)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Omaha',
  'Lincoln',
  'Bellevue',
  'Grand Island'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NE' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Nevada (NV)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Las Vegas',
  'Henderson',
  'Reno',
  'North Las Vegas',
  'Sparks',
  'Carson City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NV' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New Hampshire (NH)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Manchester',
  'Nashua',
  'Concord'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NH' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New Jersey (NJ)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Newark',
  'Jersey City',
  'Paterson',
  'Elizabeth',
  'Clifton',
  'Trenton',
  'Camden',
  'Passaic',
  'Union City',
  'Bayonne',
  'East Orange',
  'Vineland',
  'New Brunswick',
  'Hoboken',
  'Perth Amboy',
  'West New York',
  'Plainfield',
  'Hackensack',
  'Sayreville',
  'Kearny',
  'Linden',
  'Atlantic City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NJ' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New Mexico (NM)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Albuquerque',
  'Las Cruces',
  'Rio Rancho',
  'Santa Fe',
  'Roswell',
  'Farmington',
  'Clovis'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NM' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for New York (NY)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'New York',
  'Buffalo',
  'Rochester',
  'Yonkers',
  'Syracuse',
  'Albany',
  'New Rochelle',
  'Mount Vernon',
  'Schenectady',
  'Utica',
  'White Plains',
  'Hempstead',
  'Troy',
  'Niagara Falls',
  'Binghamton',
  'Freeport',
  'Valley Stream'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NY' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for North Carolina (NC)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Charlotte',
  'Raleigh',
  'Greensboro',
  'Durham',
  'Winston-Salem',
  'Fayetteville',
  'Cary',
  'Wilmington',
  'High Point',
  'Greenville',
  'Asheville',
  'Concord',
  'Gastonia',
  'Jacksonville',
  'Chapel Hill',
  'Rocky Mount',
  'Burlington',
  'Wilson',
  'Huntersville',
  'Kannapolis',
  'Apex',
  'Hickory',
  'Goldsboro'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NC' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for North Dakota (ND)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Fargo',
  'Bismarck',
  'Grand Forks',
  'Minot'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ND' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Ohio (OH)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Columbus',
  'Cleveland',
  'Cincinnati',
  'Toledo',
  'Akron',
  'Dayton',
  'Parma',
  'Canton',
  'Youngstown',
  'Lorain',
  'Hamilton',
  'Springfield',
  'Kettering',
  'Elyria',
  'Lakewood',
  'Cuyahoga Falls',
  'Middletown',
  'Euclid',
  'Newark',
  'Mansfield',
  'Mentor',
  'Beavercreek',
  'Cleveland Heights',
  'Strongsville',
  'Dublin',
  'Fairfield',
  'Findlay',
  'Warren',
  'Lancaster',
  'Lima',
  'Huber Heights',
  'Westerville',
  'Marion',
  'Grove City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OH' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Oklahoma (OK)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Oklahoma City',
  'Tulsa',
  'Norman',
  'Broken Arrow',
  'Lawton',
  'Edmond',
  'Moore',
  'Midwest City',
  'Enid',
  'Stillwater',
  'Muskogee'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OK' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Oregon (OR)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Portland',
  'Eugene',
  'Salem',
  'Gresham',
  'Hillsboro',
  'Beaverton',
  'Bend',
  'Medford',
  'Springfield',
  'Corvallis',
  'Albany',
  'Tigard',
  'Lake Oswego',
  'Keizer'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OR' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Pennsylvania (PA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Philadelphia',
  'Pittsburgh',
  'Allentown',
  'Erie',
  'Reading',
  'Scranton',
  'Bethlehem',
  'Lancaster',
  'Harrisburg',
  'Altoona',
  'York',
  'State College',
  'Wilkes-Barre'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'PA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Rhode Island (RI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Providence',
  'Warwick',
  'Cranston',
  'Pawtucket',
  'East Providence',
  'Woonsocket'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'RI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for South Carolina (SC)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Columbia',
  'Charleston',
  'North Charleston',
  'Mount Pleasant',
  'Rock Hill',
  'Greenville',
  'Summerville',
  'Sumter',
  'Goose Creek',
  'Hilton Head Island',
  'Florence',
  'Spartanburg'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'SC' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for South Dakota (SD)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Sioux Falls',
  'Rapid City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'SD' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Tennessee (TN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Memphis',
  'Nashville-Davidson',
  'Knoxville',
  'Chattanooga',
  'Clarksville',
  'Murfreesboro',
  'Jackson',
  'Franklin',
  'Johnson City',
  'Bartlett',
  'Hendersonville',
  'Kingsport',
  'Collierville',
  'Cleveland',
  'Smyrna',
  'Germantown',
  'Brentwood'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'TN' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Texas (TX)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Houston',
  'San Antonio',
  'Dallas',
  'Austin',
  'Fort Worth',
  'El Paso',
  'Arlington',
  'Corpus Christi',
  'Plano',
  'Laredo',
  'Lubbock',
  'Garland',
  'Irving',
  'Amarillo',
  'Grand Prairie',
  'Brownsville',
  'Pasadena',
  'McKinney',
  'Mesquite',
  'McAllen',
  'Killeen',
  'Frisco',
  'Waco',
  'Carrollton',
  'Denton',
  'Midland',
  'Abilene',
  'Beaumont',
  'Round Rock',
  'Odessa',
  'Wichita Falls',
  'Richardson',
  'Lewisville',
  'Tyler',
  'College Station',
  'Pearland',
  'San Angelo',
  'Allen',
  'League City',
  'Sugar Land',
  'Longview',
  'Edinburg',
  'Mission',
  'Bryan',
  'Baytown',
  'Pharr',
  'Temple',
  'Missouri City',
  'Flower Mound',
  'Harlingen',
  'North Richland Hills',
  'Victoria',
  'Conroe',
  'New Braunfels',
  'Mansfield',
  'Cedar Park',
  'Rowlett',
  'Port Arthur',
  'Euless',
  'Georgetown',
  'Pflugerville',
  'DeSoto',
  'San Marcos',
  'Grapevine',
  'Bedford',
  'Galveston',
  'Cedar Hill',
  'Texas City',
  'Wylie',
  'Haltom City',
  'Keller',
  'Coppell',
  'Rockwall',
  'Huntsville',
  'Duncanville',
  'Sherman',
  'The Colony',
  'Burleson',
  'Hurst',
  'Lancaster',
  'Texarkana',
  'Friendswood',
  'Weslaco'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'TX' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Utah (UT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Salt Lake City',
  'West Valley City',
  'Provo',
  'West Jordan',
  'Orem',
  'Sandy',
  'Ogden',
  'St. George',
  'Layton',
  'Taylorsville',
  'South Jordan',
  'Lehi',
  'Logan',
  'Murray',
  'Draper',
  'Bountiful',
  'Riverton',
  'Roy'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'UT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Vermont (VT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Burlington'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'VT' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Virginia (VA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Virginia Beach',
  'Norfolk',
  'Chesapeake',
  'Richmond',
  'Newport News',
  'Alexandria',
  'Hampton',
  'Roanoke',
  'Portsmouth',
  'Suffolk',
  'Lynchburg',
  'Harrisonburg',
  'Leesburg',
  'Charlottesville',
  'Danville',
  'Blacksburg',
  'Manassas'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'VA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Washington (WA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Seattle',
  'Spokane',
  'Tacoma',
  'Vancouver',
  'Bellevue',
  'Kent',
  'Everett',
  'Renton',
  'Yakima',
  'Federal Way',
  'Spokane Valley',
  'Bellingham',
  'Kennewick',
  'Auburn',
  'Pasco',
  'Marysville',
  'Lakewood',
  'Redmond',
  'Shoreline',
  'Richland',
  'Kirkland',
  'Burien',
  'Sammamish',
  'Olympia',
  'Lacey',
  'Edmonds',
  'Bremerton',
  'Puyallup'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WA' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for West Virginia (WV)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Charleston',
  'Huntington'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WV' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Wisconsin (WI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Milwaukee',
  'Madison',
  'Green Bay',
  'Kenosha',
  'Racine',
  'Appleton',
  'Waukesha',
  'Eau Claire',
  'Oshkosh',
  'Janesville',
  'West Allis',
  'La Crosse',
  'Sheboygan',
  'Wauwatosa',
  'Fond du Lac',
  'New Berlin',
  'Wausau',
  'Brookfield',
  'Greenfield',
  'Beloit'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WI' ON CONFLICT (name, state_id) DO NOTHING;

-- Insert cities for Wyoming (WY)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Cheyenne',
  'Casper',
  'Gillette',
  'Laramie',
  'Rock Springs',
  'Sheridan',
  'Evanston',
  'Green River',
  'Riverton',
  'Jackson',
  'Cody',
  'Rawlins',
  'Lander',
  'Powell',
  'Douglas',
  'Torrington',
  'Worland',
  'Buffalo',
  'Mills',
  'Thermopolis',
  'Glenrock',
  'Lovell',
  'Kemmerer',
  'Afton',
  'Lyman',
  'Pinedale',
  'Saratoga',
  'Greybull',
  'Wright',
  'Wheatland',
  'Newcastle',
  'Evansville',
  'Alpine',
  'Lusk',
  'Basin',
  'Meeteetse',
  'Dubois',
  'Sinclair',
  'Hulett',
  'Sundance',
  'Pine Bluffs',
  'Guernsey',
  'Moorcroft',
  'Upton',
  'Cowley',
  'Marbleton',
  'Dayton',
  'Hanna',
  'Byron',
  'Diamondville',
  'Ranchester',
  'LaGrange',
  'Mountain View',
  'Wilson',
  'Teton Village',
  'Story',
  'Centennial'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WY' ON CONFLICT (name, state_id) DO NOTHING;
