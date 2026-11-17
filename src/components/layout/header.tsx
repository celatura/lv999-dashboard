import { Separator } from '../ui/separator';
import { Breadcrumbs } from '../breadcrumbs';
import SearchInput from '../search-input';
import { ThemeModeToggle } from '../themes/theme-mode-toggle';
import { SidebarToggle } from './sidebar-toggle';

export default function Header() {
  return (
    <header className='flex h-14 shrink-0 items-center gap-3 border-b px-3 md:px-4'>
      <div className='flex min-w-0 flex-1 items-center'>
        <SidebarToggle />
        <Separator
          orientation='vertical'
          className='mr-3 ml-1.5 data-vertical:h-4 data-vertical:self-center'
        />
        <Breadcrumbs />
      </div>

      <div className='flex shrink-0 items-center gap-1'>
        <SearchInput />
        <ThemeModeToggle />
      </div>
    </header>
  );
}
