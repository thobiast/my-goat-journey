// Official Lucide geometry; sources and ISC license are in this directory.
// Pinned upstream commit: 548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde.
export function ManagementIcon({ name }: { name: 'ellipsis' | 'chevron-up' | 'chevron-down' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-chevron={name === 'ellipsis' ? undefined : name === 'chevron-up' ? 'up' : 'down'}
    >
      {name === 'ellipsis' ? (
        <>
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </>
      ) : (
        <path d={name === 'chevron-up' ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
      )}
    </svg>
  );
}
