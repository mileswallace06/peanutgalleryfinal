import { useTheme } from '@/hooks/useTheme';
import '@/components/public-page.css';

/** Public routes share the same saved theme and presentation tokens as member pages. */
export default function PublicPage({ as: Element = 'div', className = '', children, pageRef, ...props }) {
  useTheme();

  return <Element ref={pageRef} className={`pg-public-page ${className}`} {...props}>{children}</Element>;
}
