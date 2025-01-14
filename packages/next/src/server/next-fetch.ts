/**
 * Based on https://github.com/facebook/react/blob/d4e78c42a94be027b4dc7ed2659a5fddfbf9bd4e/packages/react/src/ReactFetch.js
 */
import * as React from 'react'

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- url is the cache key
const getCacheEntries = React.cache((url: string): Array<any> => [])
const simpleCacheKey = '["GET",[],null,"follow",null,null,null,null]' // generateCacheKey(new Request('https://blank'));

function generateCacheKey(request: Request): string {
  // We pick the fields that goes into the key used to dedupe requests.
  // We don't include the `cache` field, because we end up using whatever
  // caching resulted from the first request.
  // Notably we currently don't consider non-standard (or future) options.
  // This might not be safe. TODO: warn for non-standard extensions differing.
  // IF YOU CHANGE THIS UPDATE THE simpleCacheKey ABOVE.
  return JSON.stringify([
    request.method,
    Array.from(request.headers.entries()),
    request.mode,
    request.redirect,
    request.credentials,
    request.referrer,
    request.referrerPolicy,
    request.integrity,
  ])
}

if (typeof fetch === 'function') {
  const originalFetch = fetch
  const cachedFetch = function fetch(
    resource: URL | RequestInfo,
    options?: RequestInit
  ) {
    if (options && options.signal) {
      // If we're passed a signal, then we assume that
      // someone else controls the lifetime of this object and opts out of
      // caching. It's effectively the opt-out mechanism.
      // Ideally we should be able to check this on the Request but
      // it always gets initialized with its own signal so we don't
      // know if it's supposed to override - unless we also override the
      // Request constructor.
      return originalFetch(resource, options)
    }
    // Normalize the Request
    let url: string
    let cacheKey: string
    if (typeof resource === 'string' && !options) {
      // Fast path.
      cacheKey = simpleCacheKey
      url = resource
    } else {
      // Normalize the request.
      // if resource is not a string or a URL (its an instance of Request)
      // then do not instantiate a new Request but instead
      // reuse the request as to not disturb the body in the event it's a ReadableStream.
      const request =
        typeof resource === 'string' || resource instanceof URL
          ? new Request(resource, options)
          : resource
      if (
        (request.method !== 'GET' && request.method !== 'HEAD') ||
        // $FlowFixMe[prop-missing]: keepalive is real
        request.keepalive
      ) {
        // We currently don't dedupe requests that might have side-effects. Those
        // have to be explicitly cached. We assume that the request doesn't have a
        // body if it's GET or HEAD.
        // keepalive gets treated the same as if you passed a custom cache signal.
        return originalFetch(resource, options)
      }
      cacheKey = generateCacheKey(request)
      url = request.url
    }

    const cacheEntries = getCacheEntries(url)
    let match
    if (cacheEntries.length === 0) {
      // We pass the original arguments here in case normalizing the Request
      // doesn't include all the options in this environment.
      match = originalFetch(resource, options)
      cacheEntries.push(cacheKey, match)
    } else {
      // We use an array as the inner data structure since it's lighter and
      // we typically only expect to see one or two entries here.
      for (let i = 0, l = cacheEntries.length; i < l; i += 2) {
        const key = cacheEntries[i]
        const value = cacheEntries[i + 1]
        if (key === cacheKey) {
          match = value
          // I would've preferred a labelled break but lint says no.
          return match.then((response: Response) => response.clone())
        }
      }
      match = originalFetch(resource, options)
      cacheEntries.push(cacheKey, match)
    }
    // We clone the response so that each time you call this you get a new read
    // of the body so that it can be read multiple times.
    return match.then((response) => response.clone())
  }
  // We don't expect to see any extra properties on fetch but if there are any,
  // copy them over. Useful for extended fetch environments or mocks.
  Object.assign(cachedFetch, originalFetch)
  try {
    // @ts-ignore
    // eslint-disable-next-line no-native-reassign
    fetch = cachedFetch
  } catch (error1) {
    try {
      // In case assigning it globally fails, try globalThis instead just in case it exists.
      globalThis.fetch = cachedFetch
    } catch (error2) {
      // Log even in production just to make sure this is seen if only prod is frozen.
      console.warn(
        'Next.js was unable to patch the fetch() function in this environment. ' +
          'Suspensey APIs might not work correctly as a result.'
      )
    }
  }
}
