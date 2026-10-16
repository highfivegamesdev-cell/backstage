// Supabase project for Backstage. The anon key is meant to be public: it ships in the browser,
// and the database's row-level security rules (supabase/schema.sql) decide what each person can do.
// Never put the service_role / secret key here.
window.BACKSTAGE_CONFIG = {
  supabaseUrl: "https://kpafbqnjhwbqtccetoxj.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwYWZicW5qaHdicXRjY2V0b3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzkyNTQsImV4cCI6MjEwNzcxNTI1NH0.hd3cT781KUlq-sInsZl9N7C84MnxD8gu88pA6JEaj4I",
};
