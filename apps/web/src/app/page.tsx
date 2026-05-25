import { redirect } from 'next/navigation';

/**
 * Root page — redirect to Login page
 * Auth check happens client-side in the layout/pages
 */
export default function RootPage() {
  redirect('/login');
}
