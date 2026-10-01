import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export const Skeleton = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />
);
