'use client';

/** Catches errors thrown by the root layout, which `app/error.tsx` sits inside and cannot see. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Webhook Inspector is not reachable</h1>
        <p style={{ color: '#475569', fontSize: '0.875rem' }}>
          The API did not respond. Check that it is running, then try again.
        </p>
        <button
          onClick={reset}
          style={{ border: '1px solid #cbd5e1', borderRadius: '0.25rem', padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
