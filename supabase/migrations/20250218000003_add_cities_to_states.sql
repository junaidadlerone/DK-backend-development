-- Add cities column to us_states table
ALTER TABLE us_states ADD COLUMN IF NOT EXISTS cities text[] DEFAULT '{}';

-- Update each state with its cities
UPDATE us_states SET cities = '{"Birmingham","Montgomery","Mobile","Huntsville","Tuscaloosa","Hoover","Dothan","Auburn","Decatur","Madison","Florence","Gadsden"}'
  WHERE abbreviation = 'AL';

UPDATE us_states SET cities = '{"Anchorage"}'
  WHERE abbreviation = 'AK';

UPDATE us_states SET cities = '{"Phoenix","Tucson","Mesa","Chandler","Glendale","Scottsdale","Gilbert","Tempe","Peoria","Surprise","Yuma","Avondale","Goodyear","Flagstaff","Buckeye","Lake Havasu City","Casa Grande","Sierra Vista","Maricopa","Oro Valley","Prescott","Bullhead City","Prescott Valley","Marana","Apache Junction"}'
  WHERE abbreviation = 'AZ';

UPDATE us_states SET cities = '{"Little Rock","Fort Smith","Fayetteville","Springdale","Jonesboro","North Little Rock","Conway","Rogers","Pine Bluff","Bentonville"}'
  WHERE abbreviation = 'AR';

UPDATE us_states SET cities = '{"Los Angeles","San Diego","San Jose","San Francisco","Fresno","Sacramento","Long Beach","Oakland","Bakersfield","Anaheim","Santa Ana","Riverside","Stockton","Chula Vista","Irvine","Fremont","San Bernardino","Modesto","Fontana","Oxnard","Moreno Valley","Huntington Beach","Glendale","Santa Clarita","Garden Grove","Oceanside","Rancho Cucamonga","Santa Rosa","Ontario","Lancaster","Elk Grove","Corona","Palmdale","Salinas","Pomona","Hayward","Escondido","Torrance","Sunnyvale","Orange","Fullerton","Pasadena","Thousand Oaks","Visalia","Simi Valley","Concord","Roseville","Victorville","Santa Clara","Vallejo","Berkeley","El Monte","Downey","Costa Mesa","Inglewood","Carlsbad","San Buenaventura (Ventura)","Fairfield","West Covina","Murrieta","Richmond","Norwalk","Antioch","Temecula","Burbank","Daly City","Rialto","Santa Maria","El Cajon","San Mateo","Clovis","Compton","Jurupa Valley","Vista","South Gate","Mission Viejo","Vacaville","Carson","Hesperia","Santa Monica","Westminster","Redding","Santa Barbara","Chico","Newport Beach","San Leandro","San Marcos","Whittier","Hawthorne","Citrus Heights","Tracy","Alhambra","Livermore","Buena Park","Menifee","Hemet","Lakewood","Merced","Chino","Indio","Redwood City","Lake Forest","Napa","Tustin","Bellflower","Mountain View","Chino Hills","Baldwin Park","Alameda","Upland","San Ramon","Folsom","Pleasanton","Union City","Perris","Manteca","Lynwood","Apple Valley","Redlands","Turlock","Milpitas","Redondo Beach","Rancho Cordova","Yorba Linda","Palo Alto","Davis","Camarillo","Walnut Creek","Pittsburg","South San Francisco","Yuba City","San Clemente","Laguna Niguel","Pico Rivera","Montebello","Lodi","Madera","Santa Cruz","La Habra","Encinitas","Monterey Park","Tulare","Cupertino","Gardena","National City","Rocklin","Petaluma","Huntington Park","San Rafael","La Mesa","Arcadia","Fountain Valley","Diamond Bar","Woodland","Santee","Lake Elsinore","Porterville","Paramount","Eastvale","Rosemead","Hanford","Highland","Brentwood","Novato","Colton","Cathedral City","Delano","Yucaipa","Watsonville","Placentia","Glendora","Gilroy","Palm Desert","Cerritos","West Sacramento","Aliso Viejo","Poway","La Mirada","Rancho Santa Margarita","Cypress","Dublin","Covina","Azusa","Palm Springs","San Luis Obispo","Ceres","San Jacinto","Lincoln","Newark","Lompoc","El Centro","Danville","Bell Gardens","Coachella","Rancho Palos Verdes","San Bruno","Rohnert Park","Brea","La Puente","Campbell","San Gabriel","Beaumont","Morgan Hill","Culver City","Calexico","Stanton","La Quinta","Pacifica","Montclair","Oakley","Monrovia","Los Banos","Martinez"}'
  WHERE abbreviation = 'CA';

UPDATE us_states SET cities = '{"Denver","Colorado Springs","Aurora","Fort Collins","Lakewood","Thornton","Arvada","Westminster","Pueblo","Centennial","Boulder","Greeley","Longmont","Loveland","Grand Junction","Broomfield","Castle Rock","Commerce City","Parker","Littleton","Northglenn"}'
  WHERE abbreviation = 'CO';

UPDATE us_states SET cities = '{"Bridgeport","New Haven","Stamford","Hartford","Waterbury","Norwalk","Danbury","New Britain","Meriden","Bristol","West Haven","Milford","Middletown","Norwich","Shelton"}'
  WHERE abbreviation = 'CT';

UPDATE us_states SET cities = '{"Wilmington","Dover"}'
  WHERE abbreviation = 'DE';

UPDATE us_states SET cities = '{"Jacksonville","Miami","Tampa","Orlando","St. Petersburg","Hialeah","Tallahassee","Fort Lauderdale","Port St. Lucie","Cape Coral","Pembroke Pines","Hollywood","Miramar","Gainesville","Coral Springs","Miami Gardens","Clearwater","Palm Bay","Pompano Beach","West Palm Beach","Lakeland","Davie","Miami Beach","Sunrise","Plantation","Boca Raton","Deltona","Largo","Deerfield Beach","Palm Coast","Melbourne","Boynton Beach","Lauderhill","Weston","Fort Myers","Kissimmee","Homestead","Tamarac","Delray Beach","Daytona Beach","North Miami","Wellington","North Port","Jupiter","Ocala","Port Orange","Margate","Coconut Creek","Sanford","Sarasota","Pensacola","Bradenton","Palm Beach Gardens","Pinellas Park","Coral Gables","Doral","Bonita Springs","Apopka","Titusville","North Miami Beach","Oakland Park","Fort Pierce","North Lauderdale","Cutler Bay","Altamonte Springs","St. Cloud","Greenacres","Ormond Beach","Ocoee","Hallandale Beach","Winter Garden","Aventura"}'
  WHERE abbreviation = 'FL';

UPDATE us_states SET cities = '{"Atlanta","Columbus","Augusta-Richmond County","Savannah","Athens-Clarke County","Sandy Springs","Roswell","Macon","Johns Creek","Albany","Warner Robins","Alpharetta","Marietta","Valdosta","Smyrna","Dunwoody"}'
  WHERE abbreviation = 'GA';

UPDATE us_states SET cities = '{"Honolulu"}'
  WHERE abbreviation = 'HI';

UPDATE us_states SET cities = '{"Boise City","Nampa","Meridian","Idaho Falls","Pocatello","Caldwell","Coeur d''Alene","Twin Falls"}'
  WHERE abbreviation = 'ID';

UPDATE us_states SET cities = '{"Chicago","Aurora","Rockford","Joliet","Naperville","Springfield","Peoria","Elgin","Waukegan","Cicero","Champaign","Bloomington","Arlington Heights","Evanston","Decatur","Schaumburg","Bolingbrook","Palatine","Skokie","Des Plaines","Orland Park","Tinley Park","Oak Lawn","Berwyn","Mount Prospect","Normal","Wheaton","Hoffman Estates","Oak Park","Downers Grove","Elmhurst","Glenview","DeKalb","Lombard","Belleville","Moline","Buffalo Grove","Bartlett","Urbana","Quincy","Crystal Lake","Plainfield","Streamwood","Carol Stream","Romeoville","Rock Island","Hanover Park","Carpentersville","Wheeling","Park Ridge","Addison","Calumet City"}'
  WHERE abbreviation = 'IL';

UPDATE us_states SET cities = '{"Indianapolis","Fort Wayne","Evansville","South Bend","Carmel","Bloomington","Fishers","Hammond","Gary","Muncie","Lafayette","Terre Haute","Kokomo","Anderson","Noblesville","Greenwood","Elkhart","Mishawaka","Lawrence","Jeffersonville","Columbus","Portage"}'
  WHERE abbreviation = 'IN';

UPDATE us_states SET cities = '{"Des Moines","Cedar Rapids","Davenport","Sioux City","Iowa City","Waterloo","Council Bluffs","Ames","West Des Moines","Dubuque","Ankeny","Urbandale","Cedar Falls"}'
  WHERE abbreviation = 'IA';

UPDATE us_states SET cities = '{"Wichita","Overland Park","Kansas City","Olathe","Topeka","Lawrence","Shawnee","Manhattan","Lenexa","Salina","Hutchinson"}'
  WHERE abbreviation = 'KS';

UPDATE us_states SET cities = '{"Louisville/Jefferson County","Lexington-Fayette","Bowling Green","Owensboro","Covington"}'
  WHERE abbreviation = 'KY';

UPDATE us_states SET cities = '{"New Orleans","Baton Rouge","Shreveport","Lafayette","Lake Charles","Kenner","Bossier City","Monroe","Alexandria"}'
  WHERE abbreviation = 'LA';

UPDATE us_states SET cities = '{"Portland"}'
  WHERE abbreviation = 'ME';

UPDATE us_states SET cities = '{"Baltimore","Frederick","Rockville","Gaithersburg","Bowie","Hagerstown","Annapolis"}'
  WHERE abbreviation = 'MD';

UPDATE us_states SET cities = '{"Boston","Worcester","Springfield","Lowell","Cambridge","New Bedford","Brockton","Quincy","Lynn","Fall River","Newton","Lawrence","Somerville","Waltham","Haverhill","Malden","Medford","Taunton","Chicopee","Weymouth Town","Revere","Peabody","Methuen","Barnstable Town","Pittsfield","Attleboro","Everett","Salem","Westfield","Leominster","Fitchburg","Beverly","Holyoke","Marlborough","Woburn","Chelsea"}'
  WHERE abbreviation = 'MA';

UPDATE us_states SET cities = '{"Detroit","Grand Rapids","Warren","Sterling Heights","Ann Arbor","Lansing","Flint","Dearborn","Livonia","Westland","Troy","Farmington Hills","Kalamazoo","Wyoming","Southfield","Rochester Hills","Taylor","Pontiac","St. Clair Shores","Royal Oak","Novi","Dearborn Heights","Battle Creek","Saginaw","Kentwood","East Lansing","Roseville","Portage","Midland","Lincoln Park","Muskegon"}'
  WHERE abbreviation = 'MI';

UPDATE us_states SET cities = '{"Minneapolis","St. Paul","Rochester","Duluth","Bloomington","Brooklyn Park","Plymouth","St. Cloud","Eagan","Woodbury","Maple Grove","Eden Prairie","Coon Rapids","Burnsville","Blaine","Lakeville","Minnetonka","Apple Valley","Edina","St. Louis Park","Mankato","Maplewood","Moorhead","Shakopee"}'
  WHERE abbreviation = 'MN';

UPDATE us_states SET cities = '{"Jackson","Gulfport","Southaven","Hattiesburg","Biloxi","Meridian"}'
  WHERE abbreviation = 'MS';

UPDATE us_states SET cities = '{"Kansas City","St. Louis","Springfield","Independence","Columbia","Lee''s Summit","O''Fallon","St. Joseph","St. Charles","St. Peters","Blue Springs","Florissant","Joplin","Chesterfield","Jefferson City","Cape Girardeau"}'
  WHERE abbreviation = 'MO';

UPDATE us_states SET cities = '{"Billings","Missoula","Great Falls","Bozeman"}'
  WHERE abbreviation = 'MT';

UPDATE us_states SET cities = '{"Omaha","Lincoln","Bellevue","Grand Island"}'
  WHERE abbreviation = 'NE';

UPDATE us_states SET cities = '{"Las Vegas","Henderson","Reno","North Las Vegas","Sparks","Carson City"}'
  WHERE abbreviation = 'NV';

UPDATE us_states SET cities = '{"Manchester","Nashua","Concord"}'
  WHERE abbreviation = 'NH';

UPDATE us_states SET cities = '{"Newark","Jersey City","Paterson","Elizabeth","Clifton","Trenton","Camden","Passaic","Union City","Bayonne","East Orange","Vineland","New Brunswick","Hoboken","Perth Amboy","West New York","Plainfield","Hackensack","Sayreville","Kearny","Linden","Atlantic City"}'
  WHERE abbreviation = 'NJ';

UPDATE us_states SET cities = '{"Albuquerque","Las Cruces","Rio Rancho","Santa Fe","Roswell","Farmington","Clovis"}'
  WHERE abbreviation = 'NM';

UPDATE us_states SET cities = '{"New York","Buffalo","Rochester","Yonkers","Syracuse","Albany","New Rochelle","Mount Vernon","Schenectady","Utica","White Plains","Hempstead","Troy","Niagara Falls","Binghamton","Freeport","Valley Stream"}'
  WHERE abbreviation = 'NY';

UPDATE us_states SET cities = '{"Charlotte","Raleigh","Greensboro","Durham","Winston-Salem","Fayetteville","Cary","Wilmington","High Point","Greenville","Asheville","Concord","Gastonia","Jacksonville","Chapel Hill","Rocky Mount","Burlington","Wilson","Huntersville","Kannapolis","Apex","Hickory","Goldsboro"}'
  WHERE abbreviation = 'NC';

UPDATE us_states SET cities = '{"Fargo","Bismarck","Grand Forks","Minot"}'
  WHERE abbreviation = 'ND';

UPDATE us_states SET cities = '{"Columbus","Cleveland","Cincinnati","Toledo","Akron","Dayton","Parma","Canton","Youngstown","Lorain","Hamilton","Springfield","Kettering","Elyria","Lakewood","Cuyahoga Falls","Middletown","Euclid","Newark","Mansfield","Mentor","Beavercreek","Cleveland Heights","Strongsville","Dublin","Fairfield","Findlay","Warren","Lancaster","Lima","Huber Heights","Westerville","Marion","Grove City"}'
  WHERE abbreviation = 'OH';

UPDATE us_states SET cities = '{"Oklahoma City","Tulsa","Norman","Broken Arrow","Lawton","Edmond","Moore","Midwest City","Enid","Stillwater","Muskogee"}'
  WHERE abbreviation = 'OK';

UPDATE us_states SET cities = '{"Portland","Eugene","Salem","Gresham","Hillsboro","Beaverton","Bend","Medford","Springfield","Corvallis","Albany","Tigard","Lake Oswego","Keizer"}'
  WHERE abbreviation = 'OR';

UPDATE us_states SET cities = '{"Philadelphia","Pittsburgh","Allentown","Erie","Reading","Scranton","Bethlehem","Lancaster","Harrisburg","Altoona","York","State College","Wilkes-Barre"}'
  WHERE abbreviation = 'PA';

UPDATE us_states SET cities = '{"Providence","Warwick","Cranston","Pawtucket","East Providence","Woonsocket"}'
  WHERE abbreviation = 'RI';

UPDATE us_states SET cities = '{"Columbia","Charleston","North Charleston","Mount Pleasant","Rock Hill","Greenville","Summerville","Sumter","Goose Creek","Hilton Head Island","Florence","Spartanburg"}'
  WHERE abbreviation = 'SC';

UPDATE us_states SET cities = '{"Sioux Falls","Rapid City"}'
  WHERE abbreviation = 'SD';

UPDATE us_states SET cities = '{"Memphis","Nashville-Davidson","Knoxville","Chattanooga","Clarksville","Murfreesboro","Jackson","Franklin","Johnson City","Bartlett","Hendersonville","Kingsport","Collierville","Cleveland","Smyrna","Germantown","Brentwood"}'
  WHERE abbreviation = 'TN';

UPDATE us_states SET cities = '{"Houston","San Antonio","Dallas","Austin","Fort Worth","El Paso","Arlington","Corpus Christi","Plano","Laredo","Lubbock","Garland","Irving","Amarillo","Grand Prairie","Brownsville","Pasadena","McKinney","Mesquite","McAllen","Killeen","Frisco","Waco","Carrollton","Denton","Midland","Abilene","Beaumont","Round Rock","Odessa","Wichita Falls","Richardson","Lewisville","Tyler","College Station","Pearland","San Angelo","Allen","League City","Sugar Land","Longview","Edinburg","Mission","Bryan","Baytown","Pharr","Temple","Missouri City","Flower Mound","Harlingen","North Richland Hills","Victoria","Conroe","New Braunfels","Mansfield","Cedar Park","Rowlett","Port Arthur","Euless","Georgetown","Pflugerville","DeSoto","San Marcos","Grapevine","Bedford","Galveston","Cedar Hill","Texas City","Wylie","Haltom City","Keller","Coppell","Rockwall","Huntsville","Duncanville","Sherman","The Colony","Burleson","Hurst","Lancaster","Texarkana","Friendswood","Weslaco"}'
  WHERE abbreviation = 'TX';

UPDATE us_states SET cities = '{"Salt Lake City","West Valley City","Provo","West Jordan","Orem","Sandy","Ogden","St. George","Layton","Taylorsville","South Jordan","Lehi","Logan","Murray","Draper","Bountiful","Riverton","Roy"}'
  WHERE abbreviation = 'UT';

UPDATE us_states SET cities = '{"Burlington"}'
  WHERE abbreviation = 'VT';

UPDATE us_states SET cities = '{"Virginia Beach","Norfolk","Chesapeake","Richmond","Newport News","Alexandria","Hampton","Roanoke","Portsmouth","Suffolk","Lynchburg","Harrisonburg","Leesburg","Charlottesville","Danville","Blacksburg","Manassas"}'
  WHERE abbreviation = 'VA';

UPDATE us_states SET cities = '{"Seattle","Spokane","Tacoma","Vancouver","Bellevue","Kent","Everett","Renton","Yakima","Federal Way","Spokane Valley","Bellingham","Kennewick","Auburn","Pasco","Marysville","Lakewood","Redmond","Shoreline","Richland","Kirkland","Burien","Sammamish","Olympia","Lacey","Edmonds","Bremerton","Puyallup"}'
  WHERE abbreviation = 'WA';

UPDATE us_states SET cities = '{"Charleston","Huntington"}'
  WHERE abbreviation = 'WV';

UPDATE us_states SET cities = '{"Milwaukee","Madison","Green Bay","Kenosha","Racine","Appleton","Waukesha","Eau Claire","Oshkosh","Janesville","West Allis","La Crosse","Sheboygan","Wauwatosa","Fond du Lac","New Berlin","Wausau","Brookfield","Greenfield","Beloit"}'
  WHERE abbreviation = 'WI';

UPDATE us_states SET cities = '{"Cheyenne","Casper"}'
  WHERE abbreviation = 'WY';

-- Create index on cities for text search
CREATE INDEX IF NOT EXISTS idx_us_states_cities ON us_states USING GIN (cities);

-- Add comment
COMMENT ON COLUMN us_states.cities IS 'Array of city names for this state';