const SUPABASE_URL = "https://ijswdmvksmqldhkyghwr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqc3dkbXZrc21xbGRoa3lnaHdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjYxODgsImV4cCI6MjA5NDM0MjE4OH0.8JuKWiWxKQ0GN-7MmfIcuZE1BAfbNR3oxPMY89amBAM";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);