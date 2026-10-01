import { useNavigate } from 'react-router';
import { toast } from 'sonner';

/** Confirms that work went onto the translate queue, with a shortcut to watch it there. */
export const useQueuedToast = () => {
  const navigate = useNavigate();
  return (message: string, projectSlug: string) =>
    toast.success(message, { action: { label: 'Open queue', onClick: () => void navigate(`/queue?project=${projectSlug}`) } });
};
