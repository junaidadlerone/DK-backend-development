-- Drop existing us_cities table if it exists
DROP TABLE IF EXISTS us_cities CASCADE;

-- Remove cities column from us_states if it exists
ALTER TABLE us_states DROP COLUMN IF EXISTS cities;

-- Create us_cities table
CREATE TABLE us_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state_id uuid NOT NULL REFERENCES us_states(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_us_cities_state_id ON us_cities(state_id);
CREATE INDEX idx_us_cities_name ON us_cities(name);

-- Enable RLS
ALTER TABLE us_cities ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to US cities
CREATE POLICY "Anyone can view US cities"
  ON us_cities
  FOR SELECT
  USING (true);

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
CROSS JOIN us_states WHERE abbreviation = 'AL';

-- Insert cities for Alaska (AK)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Anchorage'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'AK';

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
CROSS JOIN us_states WHERE abbreviation = 'AZ';

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
CROSS JOIN us_states WHERE abbreviation = 'AR';

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
  'Irvine',
  'Chula Vista',
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
  'Vallejo'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CA';

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
  'Littleton'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CO';

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
  'Bristol',
  'Meriden',
  'Milford',
  'West Haven',
  'Middletown',
  'Norwich',
  'Shelton'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'CT';

-- Insert cities for Delaware (DE)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Wilmington',
  'Dover',
  'Newark',
  'Middletown',
  'Smyrna',
  'Milford',
  'Seaford',
  'Georgetown',
  'Elsmere',
  'New Castle'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'DE';

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
  'Sarasota'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'FL';

-- Insert cities for Georgia (GA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Atlanta',
  'Augusta',
  'Columbus',
  'Macon',
  'Savannah',
  'Athens',
  'Sandy Springs',
  'Roswell',
  'Johns Creek',
  'Albany',
  'Warner Robins',
  'Alpharetta',
  'Marietta',
  'Valdosta',
  'Smyrna',
  'Dunwoody'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'GA';

-- Insert cities for Hawaii (HI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Honolulu',
  'Pearl City',
  'Hilo',
  'Kailua',
  'Waipahu',
  'Kaneohe',
  'Mililani Town',
  'Kahului',
  'Ewa Gentry',
  'Mililani Mauka'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'HI';

-- Insert cities for Idaho (ID)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Boise',
  'Meridian',
  'Nampa',
  'Idaho Falls',
  'Pocatello',
  'Caldwell',
  'Coeur d''Alene',
  'Twin Falls',
  'Lewiston',
  'Post Falls'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ID';

-- Insert cities for Illinois (IL)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Chicago',
  'Aurora',
  'Naperville',
  'Joliet',
  'Rockford',
  'Springfield',
  'Elgin',
  'Peoria',
  'Champaign',
  'Waukegan',
  'Cicero',
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
  'Downers Grove'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IL';

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
  'Jeffersonville'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IN';

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
  'Cedar Falls',
  'Marion',
  'Bettendorf'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'IA';

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
  'Hutchinson',
  'Leavenworth',
  'Leawood',
  'Dodge City',
  'Garden City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'KS';

-- Insert cities for Kentucky (KY)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Louisville',
  'Lexington',
  'Bowling Green',
  'Owensboro',
  'Covington',
  'Hopkinsville',
  'Richmond',
  'Florence',
  'Georgetown',
  'Elizabethtown',
  'Nicholasville',
  'Henderson',
  'Jeffersontown',
  'Frankfort',
  'Paducah'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'KY';

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
  'Alexandria',
  'Houma',
  'New Iberia',
  'Central',
  'Laplace',
  'Slidell',
  'Prairieville'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'LA';

-- Insert cities for Maine (ME)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Portland',
  'Lewiston',
  'Bangor',
  'South Portland',
  'Auburn',
  'Biddeford',
  'Sanford',
  'Saco',
  'Augusta',
  'Westbrook'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ME';

-- Insert cities for Maryland (MD)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Baltimore',
  'Frederick',
  'Rockville',
  'Gaithersburg',
  'Bowie',
  'Hagerstown',
  'Annapolis',
  'College Park',
  'Salisbury',
  'Laurel',
  'Greenbelt',
  'Cumberland',
  'Westminster',
  'Hyattsville',
  'Takoma Park'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MD';

-- Insert cities for Massachusetts (MA)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Boston',
  'Worcester',
  'Springfield',
  'Cambridge',
  'Lowell',
  'Brockton',
  'New Bedford',
  'Quincy',
  'Lynn',
  'Fall River',
  'Newton',
  'Lawrence',
  'Somerville',
  'Framingham',
  'Haverhill',
  'Waltham',
  'Malden',
  'Brookline',
  'Plymouth',
  'Medford'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MA';

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
  'Royal Oak'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MI';

-- Insert cities for Minnesota (MN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Minneapolis',
  'St. Paul',
  'Rochester',
  'Bloomington',
  'Duluth',
  'Brooklyn Park',
  'Plymouth',
  'Woodbury',
  'Maple Grove',
  'Blaine',
  'Lakeville',
  'St. Cloud',
  'Eagan',
  'Burnsville',
  'Eden Prairie',
  'Coon Rapids',
  'Apple Valley',
  'Edina',
  'Minnetonka',
  'St. Louis Park'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MN';

-- Insert cities for Mississippi (MS)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Jackson',
  'Gulfport',
  'Southaven',
  'Hattiesburg',
  'Biloxi',
  'Meridian',
  'Tupelo',
  'Greenville',
  'Olive Branch',
  'Horn Lake',
  'Clinton',
  'Pearl',
  'Madison',
  'Ridgeland',
  'Starkville'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MS';

-- Insert cities for Missouri (MO)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Kansas City',
  'St. Louis',
  'Springfield',
  'Columbia',
  'Independence',
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
  'Cape Girardeau',
  'Wildwood',
  'University City',
  'Ballwin',
  'Raytown'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MO';

-- Insert cities for Montana (MT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Billings',
  'Missoula',
  'Great Falls',
  'Bozeman',
  'Butte',
  'Helena',
  'Kalispell',
  'Havre',
  'Anaconda',
  'Miles City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'MT';

-- Insert cities for Nebraska (NE)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Omaha',
  'Lincoln',
  'Bellevue',
  'Grand Island',
  'Kearney',
  'Fremont',
  'Hastings',
  'North Platte',
  'Norfolk',
  'Columbus'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NE';

-- Insert cities for Nevada (NV)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Las Vegas',
  'Henderson',
  'Reno',
  'North Las Vegas',
  'Sparks',
  'Carson City',
  'Fernley',
  'Elko',
  'Mesquite',
  'Boulder City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NV';

-- Insert cities for New Hampshire (NH)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Manchester',
  'Nashua',
  'Concord',
  'Derry',
  'Rochester',
  'Salem',
  'Dover',
  'Merrimack',
  'Londonderry',
  'Hudson'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NH';

-- Insert cities for New Jersey (NJ)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Newark',
  'Jersey City',
  'Paterson',
  'Elizabeth',
  'Trenton',
  'Clifton',
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
  'Kearny'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NJ';

-- Insert cities for New Mexico (NM)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Albuquerque',
  'Las Cruces',
  'Rio Rancho',
  'Santa Fe',
  'Roswell',
  'Farmington',
  'Clovis',
  'Hobbs',
  'Alamogordo',
  'Carlsbad'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NM';

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
CROSS JOIN us_states WHERE abbreviation = 'NY';

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
  'Kannapolis'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'NC';

-- Insert cities for North Dakota (ND)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Fargo',
  'Bismarck',
  'Grand Forks',
  'Minot',
  'West Fargo',
  'Williston',
  'Dickinson',
  'Mandan',
  'Jamestown',
  'Wahpeton'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'ND';

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
  'Mansfield'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OH';

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
  'Muskogee',
  'Bartlesville',
  'Owasso',
  'Shawnee',
  'Ponca City'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OK';

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
  'Keizer',
  'Grants Pass'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'OR';

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
  'Wilkes-Barre',
  'Chester',
  'Williamsport'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'PA';

-- Insert cities for Rhode Island (RI)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Providence',
  'Warwick',
  'Cranston',
  'Pawtucket',
  'East Providence',
  'Woonsocket',
  'Coventry',
  'Cumberland',
  'North Providence',
  'South Kingstown'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'RI';

-- Insert cities for South Carolina (SC)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Charleston',
  'Columbia',
  'North Charleston',
  'Mount Pleasant',
  'Rock Hill',
  'Greenville',
  'Summerville',
  'Sumter',
  'Goose Creek',
  'Hilton Head Island',
  'Florence',
  'Spartanburg',
  'Myrtle Beach',
  'Aiken',
  'Anderson'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'SC';

-- Insert cities for South Dakota (SD)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Sioux Falls',
  'Rapid City',
  'Aberdeen',
  'Brookings',
  'Watertown',
  'Mitchell',
  'Yankton',
  'Pierre',
  'Huron',
  'Vermillion'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'SD';

-- Insert cities for Tennessee (TN)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Memphis',
  'Nashville',
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
  'Smyrna',
  'Cleveland'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'TN';

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
  'Harlingen'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'TX';

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
  'Draper'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'UT';

-- Insert cities for Vermont (VT)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Burlington',
  'South Burlington',
  'Rutland',
  'Barre',
  'Montpelier',
  'Winooski',
  'St. Albans',
  'Newport',
  'Vergennes',
  'Brattleboro'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'VT';

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
  'Charlottesville',
  'Danville',
  'Blacksburg'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'VA';

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
  'Richland'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WA';

-- Insert cities for West Virginia (WV)
INSERT INTO us_cities (name, state_id)
SELECT city, id FROM unnest(ARRAY[
  'Charleston',
  'Huntington',
  'Morgantown',
  'Parkersburg',
  'Wheeling',
  'Weirton',
  'Fairmont',
  'Martinsburg',
  'Beckley',
  'Clarksburg'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WV';

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
  'Fond du Lac'
]) AS city
CROSS JOIN us_states WHERE abbreviation = 'WI';

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
CROSS JOIN us_states WHERE abbreviation = 'WY';
