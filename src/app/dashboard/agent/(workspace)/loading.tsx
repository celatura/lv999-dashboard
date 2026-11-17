export default function AgentWorkspaceLoading() {
  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-4'>
      <div className='bg-muted h-10 w-full animate-pulse rounded-lg' />
      <div className='flex flex-1 flex-col gap-3'>
        <div className='bg-muted h-24 w-2/3 animate-pulse rounded-lg' />
        <div className='bg-muted h-32 w-full animate-pulse rounded-lg' />
        <div className='bg-muted h-16 w-1/2 animate-pulse rounded-lg' />
      </div>
      <div className='bg-muted h-20 w-full animate-pulse rounded-lg' />
    </div>
  );
}
