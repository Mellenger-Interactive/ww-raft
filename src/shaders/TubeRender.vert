/**
 * POOL TUBE (INNER TUBE FLOAT) VERTEX SHADER
 *
 * Transforms an instanced TorusGeometry (the inflatable ring) to world space.
 * Shares the same generic approach as the Torus Knot object: the shape itself
 * carries no special-cased math, only position/normal for lighting.
 */

varying vec3 vPosition; // World position for fragment shader
varying vec3 vNormal; // Surface normal for lighting
varying vec2 vUv; // Ring/tube UVs for the striped plastic texture

void main() {
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vUv = uv;

  vec4 worldPos = instanceMatrix * vec4(position, 1.0);
  vPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
