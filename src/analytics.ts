const ANALYTICS_URL = 'https://je-motion-analytics.jonasebbecke97.workers.dev';

export type AnalyticsEvent = 'visit' | 'c3d_loaded' | 'h5_loaded';

/** Send only an event type; never add recording data or identifiers to this payload. */
export async function trackEvent(event: AnalyticsEvent): Promise<void> {
  try {
    const response = await fetch(`${ANALYTICS_URL}/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event }),
    });

    if (!response.ok) {
      console.debug(`Analytics request failed: ${response.status}`);
    }
  } catch {
    // Analytics must never interfere with JE Motion Lab.
    console.debug('Analytics unavailable');
  }
}
