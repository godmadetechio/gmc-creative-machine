-- Scale the format-scan seed roster to ~18 heavy advertisers per vertical,
-- prioritizing brands famous for creative volume. Every fb_page_url was
-- verified as the official page at research time (competitor-scout
-- discipline). on conflict do nothing keeps the insert idempotent against
-- the lower(name) unique index.

insert into format_seed_advertisers (vertical, name, fb_page_url, notes) values
  -- dtc
  ('dtc', 'Liquid Death', 'https://www.facebook.com/DrinkLiquidDeath', 'Prolific always-on Meta advertiser famous for entertainment-style creative testing; researched 2026-07'),
  ('dtc', 'Olipop', 'https://www.facebook.com/drinkolipop', 'Prebiotic-soda category leader running constant Meta video/static creative flights; researched 2026-07'),
  ('dtc', 'Ka''Chava', 'https://www.facebook.com/kachavatribe', 'Legendary DTC creative-volume advertiser — documented monthly Meta creative sprints at scale; researched 2026-07'),
  ('dtc', 'Hims', 'https://www.facebook.com/wearehims', 'One of Meta''s largest health DR spenders with continuous static+video creative testing; researched 2026-07'),
  ('dtc', 'Fabletics', 'https://www.facebook.com/Fabletics', 'Membership-model apparel giant with massive always-on Meta DR and heavy creative rotation; researched 2026-07'),
  ('dtc', 'Ritual', 'https://www.facebook.com/ritual', 'Subscription vitamin brand built on Meta acquisition with constant UGC/science-angle testing; researched 2026-07'),
  ('dtc', 'Prose', 'https://www.facebook.com/thisisprose', 'Quiz-funnel custom haircare brand with high-volume offer-led Meta creative variants; researched 2026-07'),
  ('dtc', 'Bombas', 'https://www.facebook.com/bombassocks', 'Benchmark DTC performance advertiser with years of always-on Meta creative iteration; researched 2026-07'),
  -- saas
  ('saas', 'Jasper', 'https://www.facebook.com/heyjasperai', 'Scaled to $80M+ ARR largely on aggressive Meta ad testing, widely cited SaaS paid-social case; researched 2026-07'),
  ('saas', 'Airtable', 'https://www.facebook.com/airtableapp', 'PLG SaaS with sustained Meta demand-gen testing use-case and template angles at volume; researched 2026-07'),
  ('saas', 'Miro', 'https://www.facebook.com/TryMiro', 'Official handle TryMiro (not MiroHQ); heavy always-on Meta signup funnel with continuous creative testing; researched 2026-07'),
  ('saas', 'Webflow', 'https://www.facebook.com/webflow', 'Persistent Meta acquisition campaigns with high-frequency feature/AI-angle creative refreshes; researched 2026-07'),
  ('saas', 'Zapier', 'https://www.facebook.com/ZapierApp', 'Automation leader with long-running Meta paid program testing many job-to-be-done angles; researched 2026-07'),
  ('saas', 'Calendly', 'https://www.facebook.com/calendly', 'Classic PLG Meta DR advertiser continuously testing scheduling-pain-point statics and video; researched 2026-07'),
  ('saas', 'Gusto', 'https://www.facebook.com/GustoHQ', 'SMB payroll SaaS with heavy Meta spend and multiple concurrent ad-style video variants; researched 2026-07'),
  ('saas', 'Intuit QuickBooks', 'https://www.facebook.com/IntuitQuickBooks', 'One of the largest SMB-software Meta spenders with constant seasonal/DR creative volume; researched 2026-07'),
  -- coaching
  ('coaching', 'Mel Robbins', 'https://www.facebook.com/melrobbins', 'Heavy always-on Meta ads for Let Them Theory, podcast, and paid courses/challenges; researched 2026-07'),
  ('coaching', 'Jay Shetty', 'https://www.facebook.com/jayshetty', 'Certification-school funnel is a high-volume Meta lead-gen advertiser; researched 2026-07'),
  ('coaching', 'Ed Mylett', 'https://www.facebook.com/EdMylettFanPage', 'Official page despite legacy handle (linked from edmylett.com); heavy Meta promotion of podcast, books, mentorship; researched 2026-07'),
  ('coaching', 'Bedros Keuilian', 'https://www.facebook.com/bedroskeuilian', 'Fit Body Boot Camp founder; long-running direct-response Meta advertiser for fitness-business coaching; researched 2026-07'),
  ('coaching', 'Ryan Serhant', 'https://www.facebook.com/RyanSerhantOfficial', 'Sustained Meta ad volume for Sell It sales-coaching courses/membership; researched 2026-07'),
  ('coaching', 'Codie Sanchez', 'https://www.facebook.com/codiesanchezbiz', 'Active Ad Library footprint; aggressive Meta funnels for newsletter, courses, Main Street Millionaire; researched 2026-07'),
  ('coaching', 'Jim Kwik', 'https://www.facebook.com/jimkwikofficial', 'Longtime high-volume Meta advertiser for speed-reading/memory course funnels; researched 2026-07'),
  ('coaching', 'Frank Kern', 'https://www.facebook.com/Frank.Kern.Page', 'Legendary direct-response marketer whose FB ad funnels are archived across swipe-file sites; researched 2026-07'),
  -- info
  ('info', 'Simplilearn', 'https://www.facebook.com/Simplilearn', 'Runs hundreds of concurrent Meta ads for bootcamps/certifications across geos; researched 2026-07'),
  ('info', 'DataCamp', 'https://www.facebook.com/datacampinc', 'Performance-marketing-driven data/AI course platform with continuous high-volume Meta promos; researched 2026-07'),
  ('info', 'Brilliant', 'https://www.facebook.com/brilliantorg', 'Massive always-on Meta trial-acquisition creative volume for interactive math/CS lessons; researched 2026-07'),
  ('info', 'Rosetta Stone', 'https://www.facebook.com/RosettaStone', 'Decades-long direct-response advertiser running constant Meta lifetime-deal campaigns; researched 2026-07'),
  ('info', 'Chegg', 'https://www.facebook.com/chegg', 'Large student-acquisition Meta advertiser for study/homework subscription products; researched 2026-07'),
  ('info', 'Preply', 'https://www.facebook.com/preply', 'Tutoring marketplace known for very high concurrent Meta ad counts across languages/markets; researched 2026-07'),
  ('info', 'italki', 'https://www.facebook.com/italkilanguages', '1-on-1 language-lesson marketplace with sustained multi-market Meta acquisition; researched 2026-07'),
  ('info', 'GetSmarter', 'https://www.facebook.com/GetSmarterShortCourses', '2U/edX brand running continuous Meta lead-gen for university-branded short courses; researched 2026-07'),
  -- other
  ('other', 'SHEIN', 'https://www.facebook.com/SHEINOFFICIAL', 'One of Meta''s largest advertisers by spend, thousands of concurrent catalog/DPA creatives; researched 2026-07'),
  ('other', 'Booking.com', 'https://www.facebook.com/bookingcom', 'Top-tier travel performance advertiser with massive dynamic-ad volume; researched 2026-07'),
  ('other', 'DoorDash', 'https://www.facebook.com/DoorDash', 'Heavy dual-funnel Meta spender (consumer orders + Dasher recruitment); researched 2026-07'),
  ('other', 'Instacart', 'https://www.facebook.com/Instacart', 'Major Meta spender on grocery-delivery acquisition and shopper recruitment at scale; researched 2026-07'),
  ('other', 'FanDuel', 'https://www.facebook.com/fanduel', 'Top US gambling-vertical Meta advertiser with state-by-state promo creative volume; researched 2026-07'),
  ('other', 'Klarna', 'https://www.facebook.com/Klarna', 'BNPL/fintech with high-volume Meta performance ads for app installs and co-marketing; researched 2026-07'),
  ('other', 'Etsy', 'https://www.facebook.com/Etsy', 'E-commerce giant running large-scale dynamic product ads and seasonal campaign volume; researched 2026-07'),
  ('other', 'Coinbase', 'https://www.facebook.com/Coinbase', 'Largest US crypto exchange; heavy Meta app-install and brand campaign spender; researched 2026-07')
on conflict do nothing;
