import { useRegisterActions } from 'kbar';
import { useTheme } from 'next-themes';

const useThemeSwitching = () => {
  const { theme, setTheme } = useTheme();

  const toggleDarkLight = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const themeActions = [
    {
      id: 'toggleDarkLight',
      name: '切换深色/浅色模式',
      keywords: 'toggle dark light mode',
      section: '主题',
      perform: toggleDarkLight
    },
    {
      id: 'setLightTheme',
      name: '切换为浅色主题',
      keywords: 'set light theme',
      section: '主题',
      perform: () => setTheme('light')
    },
    {
      id: 'setDarkTheme',
      name: '切换为深色主题',
      keywords: 'set dark theme',
      section: '主题',
      perform: () => setTheme('dark')
    }
  ];

  useRegisterActions(themeActions, [theme]);
};

export default useThemeSwitching;
