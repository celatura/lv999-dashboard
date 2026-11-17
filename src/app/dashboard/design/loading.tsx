export default function DesignLoading() {
  return (
    <div className='flex min-h-0 min-w-0 flex-1 animate-pulse flex-col'>
      <div className='bg-muted h-12 shrink-0 border-b' />
      <div className='flex min-h-0 flex-1'>
        <div className='bg-muted/40 flex-1' />
        <div className='bg-muted hidden w-64 shrink-0 border-l lg:block' />
      </div>
    </div>
  );
}
