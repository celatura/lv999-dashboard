import type { UIMessage } from 'ai';
import { MAX_REQUEST_BYTES } from '../constants/limits';

export function buildStopRequestBody(
  activeStreamId: string,
  assistantMessage: UIMessage | undefined
): { body: string; snapshotIncluded: boolean } {
  const body = JSON.stringify({ assistantMessage, activeStreamId });
  if (new TextEncoder().encode(body).byteLength <= MAX_REQUEST_BYTES) {
    return { body, snapshotIncluded: Boolean(assistantMessage) };
  }
  return { body: JSON.stringify({ activeStreamId }), snapshotIncluded: false };
}
