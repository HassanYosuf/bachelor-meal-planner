import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ecaakbixqzxaznrocyql.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjYWFrYml4cXp4YXpucm9jeXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzM2MjMsImV4cCI6MjA5MjAwOTYyM30.D1cC8xRU_shRcas-VHShWN1qNjEL5uFWY-IaG2BMmXM';

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
