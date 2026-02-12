-- Add comprehensive job types for all industries
-- This migration adds job types across all 41 industries from getIndustry API

INSERT INTO job_types (name) VALUES
  -- ======================================
  -- ACCOUNTING
  -- ======================================
  ('Certified Public Accountant (CPA)'),
  ('Tax Accountant'),
  ('Auditor'),
  ('Financial Analyst'),
  ('Bookkeeper'),
  ('Payroll Specialist'),
  ('Forensic Accountant'),
  ('Cost Accountant'),
  ('Management Accountant'),
  ('Internal Auditor'),
  ('External Auditor'),
  ('Accounts Payable Clerk'),
  ('Accounts Receivable Clerk'),
  ('Tax Consultant'),
  ('Budget Analyst'),

  -- ======================================
  -- ADVERTISING & MARKETING
  -- ======================================
  ('Marketing Manager'),
  ('Social Media Manager'),
  ('Content Marketing Specialist'),
  ('SEO Specialist'),
  ('PPC Specialist'),
  ('Brand Manager'),
  ('Marketing Analyst'),
  ('Copywriter'),
  ('Creative Director'),
  ('Media Buyer'),
  ('Public Relations Specialist'),
  ('Event Marketing Manager'),
  ('Product Marketing Manager'),
  ('Growth Hacker'),
  ('Marketing Coordinator'),
  ('Graphic Designer'),
  ('Video Producer'),
  ('Email Marketing Specialist'),
  ('Influencer Marketing Manager'),
  ('Digital Marketing Manager'),

  -- ======================================
  -- AEROSPACE & DEFENSE
  -- ======================================
  ('Aerospace Engineer'),
  ('Aircraft Mechanic'),
  ('Avionics Technician'),
  ('Flight Test Engineer'),
  ('Systems Engineer'),
  ('Propulsion Engineer'),
  ('Structural Engineer'),
  ('Quality Assurance Engineer'),
  ('Manufacturing Engineer'),
  ('Project Manager'),
  ('Defense Analyst'),
  ('Satellite Engineer'),
  ('Missile Systems Engineer'),
  ('Radar Engineer'),
  ('Aerospace Designer'),

  -- ======================================
  -- AGRICULTURE & FARMING
  -- ======================================
  ('Farmer'),
  ('Agricultural Engineer'),
  ('Farm Manager'),
  ('Livestock Manager'),
  ('Crop Consultant'),
  ('Soil Scientist'),
  ('Agricultural Technician'),
  ('Horticulturist'),
  ('Agronomist'),
  ('Farm Equipment Operator'),
  ('Irrigation Specialist'),
  ('Pest Control Specialist'),
  ('Food Safety Inspector'),
  ('Agricultural Sales Representative'),
  ('Ranch Manager'),

  -- ======================================
  -- ARCHITECTURE & PLANNING
  -- ======================================
  ('Architect'),
  ('Landscape Architect'),
  ('Urban Planner'),
  ('Interior Designer'),
  ('CAD Technician'),
  ('Structural Designer'),
  ('Project Architect'),
  ('BIM Manager'),
  ('Construction Administrator'),
  ('Site Planner'),
  ('Sustainable Design Consultant'),
  ('Building Inspector'),
  ('Zoning Specialist'),
  ('Historic Preservation Specialist'),

  -- ======================================
  -- AUTOMOTIVE
  -- ======================================
  ('Automotive Technician'),
  ('Automotive Engineer'),
  ('Service Manager'),
  ('Parts Manager'),
  ('Auto Body Technician'),
  ('Diagnostic Technician'),
  ('Automotive Electrician'),
  ('Transmission Specialist'),
  ('Brake Specialist'),
  ('Alignment Technician'),
  ('Paint Technician'),
  ('Detailing Specialist'),
  ('Service Advisor'),
  ('Automotive Sales Representative'),
  ('Fleet Manager'),

  -- ======================================
  -- BANKING & FINANCIAL SERVICES
  -- ======================================
  ('Bank Teller'),
  ('Loan Officer'),
  ('Financial Advisor'),
  ('Investment Banker'),
  ('Wealth Manager'),
  ('Credit Analyst'),
  ('Risk Manager'),
  ('Portfolio Manager'),
  ('Branch Manager'),
  ('Personal Banker'),
  ('Mortgage Broker'),
  ('Underwriter'),
  ('Compliance Officer'),
  ('Financial Planner'),
  ('Treasury Analyst'),

  -- ======================================
  -- BIOTECHNOLOGY
  -- ======================================
  ('Biotechnologist'),
  ('Research Scientist'),
  ('Bioinformatics Specialist'),
  ('Laboratory Technician'),
  ('Clinical Research Associate'),
  ('Biomedical Engineer'),
  ('Molecular Biologist'),
  ('Geneticist'),
  ('Biochemist'),
  ('Quality Control Analyst'),
  ('Regulatory Affairs Specialist'),
  ('Process Development Scientist'),
  ('Validation Engineer'),

  -- ======================================
  -- CONSULTING
  -- ======================================
  ('Management Consultant'),
  ('Strategy Consultant'),
  ('IT Consultant'),
  ('Business Analyst'),
  ('Change Management Consultant'),
  ('Operations Consultant'),
  ('Financial Consultant'),
  ('HR Consultant'),
  ('Marketing Consultant'),
  ('Risk Consultant'),
  ('Sustainability Consultant'),
  ('Digital Transformation Consultant'),

  -- ======================================
  -- CONSUMER ELECTRONICS
  -- ======================================
  ('Electronics Technician'),
  ('Product Manager'),
  ('Hardware Engineer'),
  ('Quality Assurance Tester'),
  ('Technical Support Specialist'),
  ('Firmware Engineer'),
  ('Product Designer'),
  ('Supply Chain Manager'),
  ('Manufacturing Engineer'),
  ('Electronics Repair Technician'),

  -- ======================================
  -- CONSUMER GOODS
  -- ======================================
  ('Product Developer'),
  ('Brand Manager'),
  ('Merchandiser'),
  ('Packaging Designer'),
  ('Quality Assurance Manager'),
  ('Supply Chain Coordinator'),
  ('Category Manager'),
  ('Pricing Analyst'),
  ('Consumer Insights Analyst'),
  ('Trade Marketing Manager'),

  -- ======================================
  -- E-COMMERCE
  -- ======================================
  ('E-commerce Manager'),
  ('E-commerce Analyst'),
  ('Conversion Rate Optimizer'),
  ('Marketplace Manager'),
  ('E-commerce Merchandiser'),
  ('Fulfillment Manager'),
  ('Customer Service Representative'),
  ('Product Listing Specialist'),
  ('E-commerce Marketing Specialist'),
  ('Web Analytics Specialist'),

  -- ======================================
  -- EDUCATION & TRAINING
  -- ======================================
  ('Teacher'),
  ('Professor'),
  ('Instructional Designer'),
  ('Training Coordinator'),
  ('Curriculum Developer'),
  ('School Administrator'),
  ('Special Education Teacher'),
  ('Guidance Counselor'),
  ('Tutor'),
  ('Corporate Trainer'),
  ('Learning & Development Manager'),
  ('Educational Consultant'),
  ('Librarian'),
  ('Teaching Assistant'),
  ('Education Program Manager'),

  -- ======================================
  -- ENERGY & UTILITIES
  -- ======================================
  ('Electrical Engineer'),
  ('Power Plant Operator'),
  ('Utility Worker'),
  ('Renewable Energy Engineer'),
  ('Energy Analyst'),
  ('Meter Reader'),
  ('Line Worker'),
  ('Substation Technician'),
  ('Energy Auditor'),
  ('Solar Installer'),
  ('Wind Turbine Technician'),
  ('Gas Distribution Technician'),
  ('Energy Trader'),
  ('Grid Operator'),

  -- ======================================
  -- ENGINEERING
  -- ======================================
  ('Civil Engineer'),
  ('Mechanical Engineer'),
  ('Chemical Engineer'),
  ('Industrial Engineer'),
  ('Environmental Engineer'),
  ('Biomedical Engineer'),
  ('Materials Engineer'),
  ('Nuclear Engineer'),
  ('Petroleum Engineer'),
  ('Mining Engineer'),
  ('Marine Engineer'),
  ('Engineering Manager'),
  ('Design Engineer'),
  ('Process Engineer'),
  ('Quality Engineer'),
  ('Safety Engineer'),
  ('Project Engineer'),
  ('Test Engineer'),
  ('Reliability Engineer'),
  ('Validation Engineer'),

  -- ======================================
  -- ENTERTAINMENT & MEDIA
  -- ======================================
  ('Producer'),
  ('Director'),
  ('Editor'),
  ('Cinematographer'),
  ('Sound Engineer'),
  ('Production Assistant'),
  ('Screenwriter'),
  ('Camera Operator'),
  ('Lighting Technician'),
  ('Makeup Artist'),
  ('Costume Designer'),
  ('Set Designer'),
  ('Music Producer'),
  ('Journalist'),
  ('Reporter'),
  ('News Anchor'),
  ('Broadcaster'),
  ('Radio Host'),
  ('Podcast Producer'),
  ('Social Media Content Creator'),

  -- ======================================
  -- ENVIRONMENTAL SERVICES
  -- ======================================
  ('Environmental Scientist'),
  ('Environmental Consultant'),
  ('Conservation Specialist'),
  ('Environmental Compliance Inspector'),
  ('Waste Management Specialist'),
  ('Recycling Coordinator'),
  ('Sustainability Coordinator'),
  ('Environmental Health & Safety Manager'),
  ('Ecologist'),
  ('Environmental Technician'),
  ('Air Quality Specialist'),
  ('Water Quality Specialist'),
  ('Hazardous Materials Specialist'),

  -- ======================================
  -- FASHION & APPAREL
  -- ======================================
  ('Fashion Designer'),
  ('Textile Designer'),
  ('Pattern Maker'),
  ('Tailor'),
  ('Seamstress'),
  ('Fashion Merchandiser'),
  ('Fashion Buyer'),
  ('Fashion Stylist'),
  ('Visual Merchandiser'),
  ('Fashion Illustrator'),
  ('Product Developer'),
  ('Technical Designer'),
  ('Quality Control Inspector'),

  -- ======================================
  -- FOOD & BEVERAGE
  -- ======================================
  ('Chef'),
  ('Sous Chef'),
  ('Line Cook'),
  ('Pastry Chef'),
  ('Baker'),
  ('Bartender'),
  ('Server'),
  ('Restaurant Manager'),
  ('Food Service Manager'),
  ('Catering Manager'),
  ('Sommelier'),
  ('Barista'),
  ('Food Scientist'),
  ('Food Safety Inspector'),
  ('Nutritionist'),
  ('Dietitian'),
  ('Menu Developer'),
  ('Kitchen Manager'),

  -- ======================================
  -- GOVERNMENT & PUBLIC SECTOR
  -- ======================================
  ('Policy Analyst'),
  ('City Planner'),
  ('Public Administrator'),
  ('Government Relations Specialist'),
  ('Legislative Assistant'),
  ('Social Worker'),
  ('Public Health Officer'),
  ('Firefighter'),
  ('Police Officer'),
  ('Corrections Officer'),
  ('Court Clerk'),
  ('Tax Collector'),
  ('Building Code Inspector'),
  ('Parks & Recreation Manager'),
  ('Emergency Management Coordinator'),

  -- ======================================
  -- HEALTHCARE & MEDICAL
  -- ======================================
  ('Physician'),
  ('Surgeon'),
  ('Nurse Practitioner'),
  ('Registered Nurse (RN)'),
  ('Licensed Practical Nurse (LPN)'),
  ('Medical Assistant'),
  ('Physician Assistant'),
  ('Pharmacist'),
  ('Pharmacy Technician'),
  ('Physical Therapist'),
  ('Occupational Therapist'),
  ('Speech Therapist'),
  ('Radiologic Technologist'),
  ('Medical Laboratory Technician'),
  ('Respiratory Therapist'),
  ('Dental Hygienist'),
  ('Dentist'),
  ('Orthodontist'),
  ('Optometrist'),
  ('Chiropractor'),
  ('Paramedic'),
  ('EMT'),
  ('Home Health Aide'),
  ('Medical Billing Specialist'),
  ('Medical Coder'),
  ('Health Information Manager'),
  ('Clinical Research Coordinator'),
  ('Anesthesiologist'),
  ('Cardiologist'),
  ('Dermatologist'),
  ('Pediatrician'),
  ('Psychiatrist'),
  ('Psychologist'),

  -- ======================================
  -- HOSPITALITY & TOURISM
  -- ======================================
  ('Hotel Manager'),
  ('Front Desk Agent'),
  ('Concierge'),
  ('Housekeeping Manager'),
  ('Event Planner'),
  ('Travel Agent'),
  ('Tour Guide'),
  ('Resort Manager'),
  ('Guest Services Manager'),
  ('Convention Services Manager'),
  ('Spa Manager'),
  ('Recreation Manager'),
  ('Cruise Director'),
  ('Reservation Agent'),

  -- ======================================
  -- HUMAN RESOURCES
  -- ======================================
  ('HR Manager'),
  ('HR Generalist'),
  ('Recruiter'),
  ('Talent Acquisition Specialist'),
  ('Compensation & Benefits Manager'),
  ('Training & Development Manager'),
  ('Employee Relations Specialist'),
  ('HR Business Partner'),
  ('Payroll Manager'),
  ('HR Analyst'),
  ('Diversity & Inclusion Manager'),
  ('Organizational Development Consultant'),

  -- ======================================
  -- INFORMATION TECHNOLOGY
  -- ======================================
  ('Software Developer'),
  ('Software Engineer'),
  ('Web Developer'),
  ('Mobile App Developer'),
  ('Full Stack Developer'),
  ('Front-End Developer'),
  ('Back-End Developer'),
  ('DevOps Engineer'),
  ('Systems Administrator'),
  ('Network Administrator'),
  ('Database Administrator'),
  ('Cloud Engineer'),
  ('Cloud Architect'),
  ('Security Engineer'),
  ('Cybersecurity Analyst'),
  ('IT Support Specialist'),
  ('Help Desk Technician'),
  ('IT Project Manager'),
  ('Scrum Master'),
  ('Product Owner'),
  ('Data Scientist'),
  ('Data Analyst'),
  ('Business Intelligence Analyst'),
  ('Machine Learning Engineer'),
  ('AI Engineer'),
  ('QA Engineer'),
  ('QA Tester'),
  ('Site Reliability Engineer'),
  ('Network Engineer'),
  ('IT Consultant'),
  ('IT Director'),
  ('Chief Technology Officer (CTO)'),
  ('Chief Information Officer (CIO)'),
  ('UI/UX Designer'),
  ('Technical Writer'),
  ('Solutions Architect'),

  -- ======================================
  -- INSURANCE
  -- ======================================
  ('Insurance Agent'),
  ('Insurance Broker'),
  ('Underwriter'),
  ('Claims Adjuster'),
  ('Claims Examiner'),
  ('Actuary'),
  ('Risk Analyst'),
  ('Loss Control Specialist'),
  ('Insurance Sales Representative'),
  ('Policy Analyst'),

  -- ======================================
  -- LEGAL SERVICES
  -- ======================================
  ('Attorney'),
  ('Lawyer'),
  ('Paralegal'),
  ('Legal Assistant'),
  ('Corporate Counsel'),
  ('Litigation Attorney'),
  ('Contract Attorney'),
  ('Patent Attorney'),
  ('Immigration Attorney'),
  ('Family Law Attorney'),
  ('Criminal Defense Attorney'),
  ('Prosecutor'),
  ('Public Defender'),
  ('Legal Secretary'),
  ('Court Reporter'),
  ('Legal Researcher'),
  ('Compliance Attorney'),

  -- ======================================
  -- LOGISTICS & SUPPLY CHAIN
  -- ======================================
  ('Logistics Manager'),
  ('Supply Chain Manager'),
  ('Warehouse Manager'),
  ('Inventory Manager'),
  ('Transportation Coordinator'),
  ('Procurement Specialist'),
  ('Logistics Coordinator'),
  ('Distribution Manager'),
  ('Freight Broker'),
  ('Shipping & Receiving Clerk'),
  ('Supply Chain Analyst'),
  ('Demand Planner'),
  ('Materials Manager'),
  ('Import/Export Coordinator'),

  -- ======================================
  -- MANUFACTURING
  -- ======================================
  ('Production Manager'),
  ('Manufacturing Engineer'),
  ('Quality Control Inspector'),
  ('Assembly Line Worker'),
  ('Machine Operator'),
  ('CNC Machinist'),
  ('Tool & Die Maker'),
  ('Maintenance Technician'),
  ('Industrial Mechanic'),
  ('Production Supervisor'),
  ('Plant Manager'),
  ('Continuous Improvement Manager'),
  ('Lean Manufacturing Specialist'),
  ('Production Planner'),

  -- ======================================
  -- MINING & METALS
  -- ======================================
  ('Mining Engineer'),
  ('Geologist'),
  ('Metallurgist'),
  ('Mine Supervisor'),
  ('Driller'),
  ('Blaster'),
  ('Heavy Equipment Operator'),
  ('Safety Coordinator'),
  ('Mine Planner'),
  ('Environmental Compliance Specialist'),

  -- ======================================
  -- NON-PROFIT & NGO
  -- ======================================
  ('Program Manager'),
  ('Grant Writer'),
  ('Fundraising Manager'),
  ('Volunteer Coordinator'),
  ('Outreach Coordinator'),
  ('Advocacy Specialist'),
  ('Community Organizer'),
  ('Development Director'),
  ('Communications Manager'),
  ('Non-Profit Executive Director'),

  -- ======================================
  -- OIL & GAS
  -- ======================================
  ('Petroleum Engineer'),
  ('Drilling Engineer'),
  ('Reservoir Engineer'),
  ('Production Engineer'),
  ('Geoscientist'),
  ('Well Logger'),
  ('Rig Manager'),
  ('Pipeline Engineer'),
  ('Refinery Operator'),
  ('Process Engineer'),
  ('HSE Manager'),
  ('Landman'),

  -- ======================================
  -- PHARMACEUTICALS
  -- ======================================
  ('Pharmacist'),
  ('Pharmaceutical Sales Representative'),
  ('Clinical Research Associate'),
  ('Regulatory Affairs Manager'),
  ('Pharmaceutical Scientist'),
  ('Formulation Scientist'),
  ('Quality Assurance Manager'),
  ('Medical Science Liaison'),
  ('Drug Safety Associate'),
  ('Pharmaceutical Technician'),

  -- ======================================
  -- REAL ESTATE
  -- ======================================
  ('Real Estate Agent'),
  ('Real Estate Broker'),
  ('Property Manager'),
  ('Leasing Agent'),
  ('Real Estate Appraiser'),
  ('Real Estate Analyst'),
  ('Real Estate Developer'),
  ('Facilities Manager'),
  ('Landlord'),
  ('Asset Manager'),
  ('Commercial Real Estate Agent'),
  ('Residential Real Estate Agent'),
  ('Real Estate Marketing Manager'),

  -- ======================================
  -- RETAIL
  -- ======================================
  ('Store Manager'),
  ('Assistant Store Manager'),
  ('Sales Associate'),
  ('Cashier'),
  ('Stock Clerk'),
  ('Visual Merchandiser'),
  ('Retail Buyer'),
  ('Loss Prevention Specialist'),
  ('Customer Service Representative'),
  ('Department Manager'),
  ('Inventory Specialist'),
  ('Retail Manager'),

  -- ======================================
  -- SECURITY SERVICES
  -- ======================================
  ('Security Guard'),
  ('Security Manager'),
  ('Security Consultant'),
  ('Loss Prevention Officer'),
  ('Surveillance Operator'),
  ('Armed Security Officer'),
  ('Security Analyst'),
  ('Cybersecurity Specialist'),
  ('Information Security Manager'),
  ('Security Systems Technician'),

  -- ======================================
  -- SPORTS & RECREATION
  -- ======================================
  ('Athletic Trainer'),
  ('Personal Trainer'),
  ('Fitness Instructor'),
  ('Coach'),
  ('Sports Manager'),
  ('Recreation Director'),
  ('Sports Marketing Manager'),
  ('Event Coordinator'),
  ('Strength & Conditioning Coach'),
  ('Yoga Instructor'),
  ('Pilates Instructor'),
  ('Lifeguard'),
  ('Camp Counselor'),

  -- ======================================
  -- TELECOMMUNICATIONS
  -- ======================================
  ('Telecommunications Engineer'),
  ('Network Engineer'),
  ('Telecom Technician'),
  ('Field Service Technician'),
  ('RF Engineer'),
  ('Network Planner'),
  ('Voice & Data Technician'),
  ('Tower Climber'),
  ('Telecommunications Analyst'),
  ('Customer Service Representative'),

  -- ======================================
  -- TRANSPORTATION
  -- ======================================
  ('Truck Driver'),
  ('Delivery Driver'),
  ('Bus Driver'),
  ('Pilot'),
  ('Flight Attendant'),
  ('Air Traffic Controller'),
  ('Train Engineer'),
  ('Ship Captain'),
  ('Dispatcher'),
  ('Transportation Manager'),
  ('Logistics Driver'),
  ('Forklift Operator'),
  ('Taxi Driver'),
  ('Rideshare Driver'),
  ('Commercial Driver')

ON CONFLICT (name) DO NOTHING;

-- Add comment
COMMENT ON TABLE job_types IS 'Comprehensive job types across all 41 industries including Accounting, Advertising, Aerospace, Agriculture, Architecture, Automotive, Banking, Biotechnology, Construction, Consulting, Consumer Electronics, Consumer Goods, E-commerce, Education, Energy, Engineering, Entertainment, Environmental, Fashion, Food & Beverage, Government, Healthcare, Hospitality, HR, IT, Insurance, Legal, Logistics, Manufacturing, Mining, Non-Profit, Oil & Gas, Pharmaceuticals, Real Estate, Retail, Security, Software, Sports, Telecommunications, and Transportation';
