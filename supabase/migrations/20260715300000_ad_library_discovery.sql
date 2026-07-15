-- Advertiser discovery loop: keyword searches surface advertisers the scout
-- never found. When a keyword-discovered advertiser has an ad running >= 30
-- days, it is auto-registered as a competitor so future runs pull its page.
alter type competitor_source add value if not exists 'ad_library_discovery';
