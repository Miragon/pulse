import { useEffect, useRef } from 'preact/hooks';
import type { WebviewIntent } from '../../core/protocol/index.js';
import { useHost } from './host-context.js';

export function useLiveHold(): void {
  const host = useHost();
  const post = useRef((intent: WebviewIntent) => {
    host.post(intent);
  });
  post.current = (intent) => {
    host.post(intent);
  };
  useEffect(() => {
    post.current({ type: 'holdLiveUpdates', held: true });
    return () => {
      post.current({ type: 'holdLiveUpdates', held: false });
    };
  }, []);
}
