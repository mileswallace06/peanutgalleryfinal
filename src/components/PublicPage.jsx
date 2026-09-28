import { useTheme } from '@/hooks/useTheme';
import '@/components/public-page.css';

/** Public routes share the same saved theme and presentation tokens as member pages. */
export default function PublicPage({ as: Element = 'div', className = '', children, ...props }) {
  useTheme();

  return <Element className={`pg-public-page ${className}`} {...props}>{children}</Element>;
}
