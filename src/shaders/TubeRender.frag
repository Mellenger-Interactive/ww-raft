precision highp float;

/**
 * POOL TUBE (INNER TUBE FLOAT) FRAGMENT SHADER
 *
 * Renders the inflatable ring with underwater lighting effects.
 * Identical lighting model to the Torus Knot object, but the base plastic
 * color and the ambient-occlusion shadow radius are configurable per
 * instance so the Single/Double/Triple tube variants can share one shader.
 */

// Optical constants
const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;
const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);

// Light direction (pointing toward sun)
uniform vec3 light;

// Striped inflatable-plastic texture (varies per size/variant)
uniform sampler2D map;
// Approximate radius used for ambient-occlusion falloff against pool walls/floor
uniform float shadowRadius;

// Pool dimensions for UV coordinate mapping
uniform float poolWidth;
uniform float poolLength;
uniform float poolHeight;

// Simulation textures
uniform sampler2D water; // Wave heightmap
uniform sampler2D causticTex; // Caustic intensity map

// Render pass mode:
// 1 = Standard rendering (refraction pass) - render everything
// 2 = Reflection pass - discard underwater fragments
uniform int texturePassMode;

varying vec3 vPosition; // World-space position
varying vec3 vNormal; // Surface normal
varying vec2 vUv; // Ring/tube UVs

void main() {
  vec3 color = texture2D(map, vUv).rgb;

  // Calculate refracted light direction vector entering the water surface
  vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);

  // Modulate ambient occlusion strength by light alignment
  float litFactor = max(0.0, dot(normalize(vNormal), -refractedLight));
  float aoStrength = 0.6 * (1.0 - litFactor);

  // Approximate ambient occlusion (shadowing) as the tube gets close to the pool walls/floor
  color *= 1.0 - aoStrength / pow((poolWidth + shadowRadius - abs(vPosition.x)) / shadowRadius, 3.0);
  color *= 1.0 - aoStrength / pow((poolLength + shadowRadius - abs(vPosition.z)) / shadowRadius, 3.0);
  color *= 1.0 - aoStrength / pow((vPosition.y + poolHeight + shadowRadius) / shadowRadius, 3.0);

  // Calculate diffuse illumination using normal and refracted light vector
  float diffuse = max(0.0, dot(-refractedLight, normalize(vNormal))) * 0.5;

  // Glossy highlight so the vinyl reads as inflated plastic rather than matte
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  vec3 halfVector = normalize(normalize(light) + viewDirection);
  float specular = pow(max(0.0, dot(normalize(vNormal), halfVector)), 28.0) * 0.5;

  // Sample local water surface displacement height
  vec4 info = texture2D(water, vPosition.xz * vec2(0.5 / poolWidth, 0.5 / poolLength) + 0.5);

  // Clip submerged fragments if rendering above-water reflections (mode == 2)
  if (texturePassMode == 2 && vPosition.y < info.r) {
    discard;
  }

  // If tube fragment is submerged:
  if (vPosition.y < info.r) {
    vec4 caustic = texture2D(
      causticTex,
      0.75 *
        (vPosition.xz - vPosition.y * refractedLight.xz / refractedLight.y) *
        vec2(0.5 / poolWidth, 0.5 / poolLength) +
        0.5
    );
    diffuse = (diffuse + 0.06) * caustic.r * 4.0;
    specular = 0.0; // No direct sun glint below the surface
  }

  color += diffuse + specular;

  // Apply underwater blue-green color absorption multiplier
  if (vPosition.y < info.r) {
    color *= underwaterColor * 1.2;
  }

  gl_FragColor = vec4(color, 1.0);
}
