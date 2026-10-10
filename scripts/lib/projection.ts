/**
 * Re-exports the projection the browser uses, so build-time coastlines and view-time
 * incidents can never be projected with different maths. The implementation lives in
 * www/projection.js because that is the copy the front page loads.
 */
export {
  projectNaturalEarth,
  toView,
  X_MAX,
  Y_MAX,
  VIEW_WIDTH,
  VIEW_HEIGHT,
} from '../../www/projection.js';
