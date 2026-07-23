-- Two-stage still_ads (concept plan preview): after the concept agent runs,
-- the run pauses at 'plan_review' with the text-only plan in output_json.
-- The dashboard's "Generate approved (N)" action writes the approved
-- concepts into input_json and re-queues the run for image generation.
alter type run_status add value if not exists 'plan_review';
