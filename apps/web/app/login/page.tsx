import { AuthForm } from './auth-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return <AuthForm mode={mode === 'signup' ? 'signup' : 'login'} />;
}
