import { Link } from 'react-router';
import { truncate } from '../lib/utils';
import { Badge } from './ui/badge';

type KeyedResource = { key: string; meta: Record<string, unknown> };

/** File adapters key a resource by a JSON of its parts and repeat them in `meta`: the inner key names it, the file and variant qualify it. */
export const keyParts = ({ key, meta }: KeyedResource) => ({
  name: typeof meta.key === 'string' ? meta.key : key,
  variant: typeof meta.quantity === 'string' ? meta.quantity : typeof meta.index === 'number' ? `#${meta.index}` : undefined,
  file: typeof meta.filePath === 'string' ? meta.filePath : undefined,
});

export const ResourceKey = ({ id, resource, max }: { id: string; resource: KeyedResource; max: number }) => {
  const { name, variant, file } = keyParts(resource);
  return (
    <div className="grid gap-0.5">
      <div className="flex items-center gap-1.5">
        <Link to={`/resources/${id}`} className="font-mono text-xs text-primary hover:underline">
          {truncate(name, max)}
        </Link>
        {variant ? <Badge variant="outline">{variant}</Badge> : null}
      </div>
      {file ? (
        <span className="font-mono text-xs text-muted-foreground" title={file}>
          {truncate(file, max)}
        </span>
      ) : null}
    </div>
  );
};
