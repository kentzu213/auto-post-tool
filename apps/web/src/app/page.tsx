import { redirect } from 'next/navigation';

/**
 * Root page — redirect to Composer (main working page)
 */
export default function RootPage() {
  redirect('/composer');
}
