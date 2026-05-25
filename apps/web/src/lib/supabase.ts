import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Cờ kiểm tra xem Supabase đã được cấu hình hay chưa
export const isSupabaseConfigured = 
  supabaseUrl.length > 0 && 
  supabaseAnonKey.length > 0 &&
  !supabaseUrl.includes('your-supabase-project') &&
  !supabaseAnonKey.includes('your-supabase-anon-key');

// Khởi tạo Supabase client (nếu không cấu hình thì dùng Mock hoặc null)
export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

if (isSupabaseConfigured) {
  console.log('⚡ Supabase Auth client initialized successfully.');
} else {
  console.log('⚠️ Supabase URL or Anon Key is missing. Falling back to Local Auth.');
}
