/**
 * Global Seismic Hazard Map - Professional Version with Fault Line Analysis
 * GEM Foundation v2023.1
 * Handles map visualization, location search, seismic hazard data, and fault distance calculation
 *
 * Refactored for maintainability while preserving all original logic and functionality.
 */

(function () {
  "use strict";

  // SECTION 1: CONFIGURATION & CONSTANTS

  // Map Settings
  const CONFIG = {
    // Map Viewport
    defaultCenter: [20, 0],
    defaultZoom: 2,
    minZoom: 2,
    maxZoom: 6,

    maxBounds: [
      [-60, -180],
      [84, 180],
    ],

    // Tile Settings
    tilePath: "tiles/{z}/{x}/{y}.png",
    hazardOpacity: 0.75,

    // Map Animation
    flyToZoom: 6,
    flyToDuration: 1.2,

    // External APIs
    nominatimEndpoint: "https://nominatim.openstreetmap.org/search",
    userAgent: "SeismicHazardMap/1.0",

    // Feature Toggles
    faultZoomThreshold: 5,
  };

  // PGA Color Lookup Table
  const PGA_LOOKUP_TABLE = [
    { color: [255, 255, 255], min: 0.0, max: 0.01, level: "Very Low" },
    { color: [215, 227, 238], min: 0.01, max: 0.02, level: "Low" },
    { color: [181, 202, 255], min: 0.02, max: 0.03, level: "Low-Moderate" },
    { color: [143, 179, 255], min: 0.03, max: 0.05, level: "Moderate" },
    { color: [127, 151, 255], min: 0.05, max: 0.08, level: "Moderate-High" },
    { color: [171, 207, 99], min: 0.08, max: 0.13, level: "High" },
    { color: [232, 245, 158], min: 0.13, max: 0.2, level: "High" },
    { color: [255, 250, 20], min: 0.2, max: 0.35, level: "Very High" },
    { color: [255, 209, 33], min: 0.35, max: 0.55, level: "Very High" },
    { color: [255, 163, 10], min: 0.55, max: 0.9, level: "Extreme" },
    { color: [255, 76, 0], min: 0.9, max: 1.5, level: "Extreme" },
  ];

  // Build RGB → Hazard lookup map
  const RGB_TO_HAZARD = new Map();
  PGA_LOOKUP_TABLE.forEach((item) => {
    const rgbKey = item.color.join(",");
    RGB_TO_HAZARD.set(rgbKey, {
      pga: (item.min + item.max) / 2,
      level: item.level,
      min: item.min,
      max: item.max,
      color: item.color,
      rgbKey: rgbKey,
    });
  });

  // Fault distance thresholds
  const FAULT_THRESHOLDS = {
    CRITICAL: 10,
    HIGH: 30,
    MODERATE: 60,
    LOW: 100,
    LINE_DISPLAY_DURATION: 8000,
  };

  // SECTION 2: GLOBAL STATE VARIABLES

  // Map layers
  let map = null;
  let currentMarker = null;
  let hazardLayer = null;
  let currentBasemap = null;
  let countryBoundaryLayer = null;
  let faultLayer = null;

  // UI State
  let currentHazardOpacity = CONFIG.hazardOpacity;
  let isHazardVisible = true;
  let isFaultVisible = false;

  // Data stores
  let countryGeoJSON = null;
  let dynamicCountryData = {};

  // Async state
  let currentNominatimController = null;
  let faultLoading = false;
  let tileErrorCount = 0;

  // Fault line visual elements
  let faultDistanceLine = null;
  let nearestFaultMarker = null;

  // Current analysis results
  let currentFaultInfo = null;

  


  // SECTION 3: UTILITY FUNCTIONS

  /**
   * Formats coordinates as degrees with cardinal directions
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {string} Formatted coordinate string (e.g., "40.7128° N, 74.0060° W")
   */

  function formatCoordinates(lat, lng) {
    const latDir = lat >= 0 ? "N" : "S";
    const lngDir = lng >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
  }

  /**
   * Escapes HTML special characters to prevent XSS
   * @param {string} str - Input string
   * @returns {string} Escaped HTML string
   */
  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Updates the map status indicator
   * @param {string} text - Status message
   * @param {boolean} isReady - Whether the map is ready (activates green dot)
   */
  function updateStatus(text, isReady) {
    const statusText = document.getElementById("statusText");
    const statusDot = document.querySelector(".status-dot");

    if (statusText) statusText.textContent = text;
    if (statusDot) {
      isReady
        ? statusDot.classList.add("active")
        : statusDot.classList.remove("active");
    }
  }

  /**
   * Creates an expanding circle animation at click location
   * @param {number} lat - Latitude of click
   * @param {number} lng - Longitude of click
   */
  function showClickAnimation(lat, lng) {
    const START_RADIUS = 20000;
    const MAX_RADIUS = 120000;
    const STEP_SIZE = 20000;
    const INTERVAL_MS = 60;
    const MAX_OPACITY = 0.3;

    const circle = L.circle([lat, lng], {
      radius: START_RADIUS,
      color: "#005187",
      fillColor: "#005187",
      fillOpacity: MAX_OPACITY,
      weight: 1,
    }).addTo(map);

    let currentRadius = START_RADIUS;

    const interval = setInterval(() => {
      currentRadius += STEP_SIZE;
      circle.setRadius(currentRadius);

      const newOpacity = Math.max(0, MAX_OPACITY - currentRadius / MAX_RADIUS);
      circle.setStyle({ fillOpacity: newOpacity });

      if (currentRadius >= MAX_RADIUS) {
        clearInterval(interval);
        map.removeLayer(circle);
      }
    }, INTERVAL_MS);
  }

  /**
   * Disables or enables form inputs when PGA data is unavailable
   * @param {boolean} isDisabled - Whether to disable form inputs
   */
  function setFormDisabled(isDisabled) {
    const elements = [
      document.getElementById("propertyType"),
      document.getElementById("buildingType"),
      document.getElementById("buildingStories"),
      document.getElementById("seismicAssessmentDone"),
    ];

    elements.forEach((el) => {
      if (el) el.disabled = isDisabled;
    });

    const checkboxes = document.querySelectorAll(
      '.documents-option input[type="checkbox"]',
    );
    checkboxes.forEach((cb) => (cb.disabled = isDisabled));
  }

  //  HAZARD FUNCTIONS

  /**
   * Finds the closest hazard level by comparing RGB values with tolerance
   * @param {number} r - Red channel value
   * @param {number} g - Green channel value
   * @param {number} b - Blue channel value
   * @returns {Object} PGA value and hazard level
   */
  function findClosestHazard(r, g, b) {
    let minDist = Infinity;
    let closest = null;

    for (const hazard of PGA_LOOKUP_TABLE) {
      const [cr, cg, cb] = hazard.color;

      const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;

      if (dist < minDist) {
        minDist = dist;
        closest = hazard;
      }
    }

    return {
      pga: (closest.min + closest.max) / 2,
      level: closest.level,
      min: closest.min,
      max: closest.max,
    };
  }

  /**
   * Provides fallback PGA estimates for regions when tile data is unavailable
   * Uses known seismic zones (Ring of Fire, Mediterranean, etc.)
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Object} PGA value and hazard level
   */
  function getHazardEstimate(lat, lng) {
    // Pacific Ring of Fire (Extreme)
    if (
      (lat > 20 && lat < 50 && lng > 130 && lng < 150) ||
      (lat > -10 && lat < 20 && lng > 120 && lng < 140) ||
      (lat > 30 && lat < 60 && lng > -130 && lng < -110) ||
      (lat > -40 && lat < -20 && lng > -80 && lng < -60)
    ) {
      return { pga: 0.65, level: "Extreme" };
    }
    // Mediterranean / Himalayan (Very High)
    if (
      (lat > 35 && lat < 45 && lng > 10 && lng < 30) ||
      (lat > 25 && lat < 40 && lng > 70 && lng < 90)
    ) {
      return { pga: 0.35, level: "Very High" };
    }
    // High seismicity regions
    if (
      (lat > 30 && lat < 45 && lng > 70 && lng < 85) ||
      (lat > -20 && lat < -5 && lng > -75 && lng < -60)
    ) {
      return { pga: 0.105, level: "High" };
    }
    // Moderate-High regions
    if (
      (lat > 30 && lat < 45 && lng > -125 && lng < -110) ||
      (lat > 35 && lat < 50 && lng > -10 && lng < 20)
    ) {
      return { pga: 0.065, level: "Moderate-High" };
    }
    // Default
    return { pga: 0.025, level: "Low-Moderate" };
  }

  /**
   * Reads hazard value from raster tile pixel at given coordinates
   * Falls back to estimate if tile is unavailable
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Promise<Object|null>} Hazard info or null if ocean area
   */
  async function getHazardFromRaster(lat, lng) {
    return new Promise((resolve) => {
      try {
        const currentZoom = CONFIG.maxZoom; // ALWAYS sample at native tile zoom (6)
        const point = map.project([lat, lng], currentZoom);
        const tileSize = 256;
        const tileX = Math.floor(point.x / tileSize);
        const tileY = Math.floor(point.y / tileSize);

        const tileUrl = CONFIG.tilePath
          .replace("{z}", currentZoom)
          .replace("{x}", tileX)
          .replace("{y}", tileY);

        const img = new Image();
        img.crossOrigin = "Anonymous";

        const timeoutId = setTimeout(() => {
          console.warn("Tile load timeout, using estimate");
          resolve(getHazardEstimate(lat, lng));
        }, 3000);

        img.onload = function () {
          clearTimeout(timeoutId);
          try {
            const canvas = document.createElement("canvas");
            canvas.width = tileSize;
            canvas.height = tileSize;
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0);

            const pixelX = Math.floor(point.x) - tileX * tileSize;
            const pixelY = Math.floor(point.y) - tileY * tileSize;

            const imageData = ctx.getImageData(pixelX, pixelY, 1, 1);
            const [r, g, b] = imageData.data;

            // Check for transparent or white pixels (ocean/void)
            if (imageData.data[3] === 0 || (r > 240 && g > 240 && b > 240)) {
              resolve(null);
              return;
            }

            resolve(findClosestHazard(r, g, b));
          } catch (err) {
            console.error("Error reading tile pixel:", err);
            resolve(getHazardEstimate(lat, lng));
          }
        };

        img.onerror = function () {
          clearTimeout(timeoutId);
          tileErrorCount++;
          if (tileErrorCount > 10) {
            console.warn("Multiple tile loading errors, using estimates");
            tileErrorCount = 0;
          }
          resolve(getHazardEstimate(lat, lng));
        };

        img.src = tileUrl;
      } catch (error) {
        console.error("Error in getHazardFromRaster:", error);
        resolve(getHazardEstimate(lat, lng));
      }
    });
  }

  // SECTION 5: FAULT ANALYSIS FUNCTIONS
  /**
   * Extracts coordinates from GeoJSON geometry (handles LineString and MultiLineString)
   * @param {Object} geometry - GeoJSON geometry object
   * @returns {Array|null} Array of coordinates or null if invalid
   */
  function extractFaultCoordinates(geometry) {
    if (!geometry) return null;

    if (geometry.type === "LineString") {
      return geometry.coordinates;
    }

    if (geometry.type === "MultiLineString") {
      let longestSegment = null;
      let maxLength = 0;

      for (const line of geometry.coordinates) {
        if (line.length > maxLength) {
          maxLength = line.length;
          longestSegment = line;
        }
      }
      return longestSegment;
    }

    return null;
  }

  /**
   * Returns a human-readable risk message based on distance to nearest fault
   * @param {number} distanceKm - Distance to nearest fault in kilometers
   * @returns {string} Risk assessment message
   */
  function getFaultDistanceMessage(distanceKm) {
    if (distanceKm < FAULT_THRESHOLDS.CRITICAL) {
      return "🔴 CRITICAL: Very close to active fault! Special seismic design required.";
    }
    if (distanceKm < FAULT_THRESHOLDS.HIGH) {
      return "🟠 HIGH: Within 30km of active fault. Enhanced design recommended.";
    }
    if (distanceKm < FAULT_THRESHOLDS.MODERATE) {
      return "🟡 MODERATE: Within 60km of fault. Standard seismic design advised.";
    }
    if (distanceKm < FAULT_THRESHOLDS.LOW) {
      return "🟢 LOW: Beyond 60km from major faults. Regular seismic considerations apply.";
    }
    return "✅ VERY LOW: Far from known active faults.";
  }

  /**
   * Calculates distance from a point to the nearest fault line using Turf.js
   * @param {number} lat - Latitude of selected point
   * @param {number} lng - Longitude of selected point
   * @returns {Object} Distance, fault name, fault type, nearest point, and message
   */
  function calculateDistanceToNearestFault(lat, lng) {
    if (!faultLayer || faultLoading || !map.hasLayer(faultLayer)) {
      return {
        distance: null,
        nearestFault: null,
        faultType: null,
        nearestPoint: null,
        message: "Fault layer not active or not loaded",
      };
    }

    let minDistance = Infinity;
    let nearestFaultName = null;
    let nearestFaultType = null;
    let nearestPoint = null;

    const clickPoint = turf.point([lng, lat]);

    faultLayer.eachLayer((layer) => {
      if (!layer.feature?.geometry) return;

      try {
        const coordinates = extractFaultCoordinates(layer.feature.geometry);
        if (!coordinates) return;

        const faultLine = turf.lineString(coordinates);
        const distance = turf.pointToLineDistance(clickPoint, faultLine, {
          units: "kilometers",
        });

        if (distance < minDistance) {
          minDistance = distance;
          const props = layer.feature.properties || {};

          nearestFaultName =
            props.name || props.Name || props.fault_name || "Unnamed Fault";
          nearestFaultType = props.slip_type || props.slipType || "Unknown";

          const nearest = turf.nearestPointOnLine(faultLine, clickPoint);
          nearestPoint = nearest.geometry.coordinates;
        }
      } catch (err) {
        console.warn("Error calculating distance for fault:", err);
      }
    });

    if (minDistance === Infinity) {
      return {
        distance: null,
        nearestFault: null,
        faultType: null,
        nearestPoint: null,
        message: "No faults found in this region",
      };
    }

    return {
      distance: minDistance,
      nearestFault: nearestFaultName,
      faultType: nearestFaultType,
      nearestPoint: nearestPoint,
      message: getFaultDistanceMessage(minDistance),
    };
  }

  /**
   * Draws a temporary dashed line from click point to nearest fault point
   * @param {Array} clickLngLat - Click coordinates [lng, lat]
   * @param {Array} nearestPoint - Nearest fault point coordinates [lng, lat]
   * @param {string} faultName - Name of the nearest fault
   */
  function showFaultDistanceLine(clickLngLat, nearestPoint, faultName) {
    if (faultDistanceLine) map.removeLayer(faultDistanceLine);
    if (nearestFaultMarker) map.removeLayer(nearestFaultMarker);

    if (!nearestPoint) return;

    const latlngs = [
      [clickLngLat[1], clickLngLat[0]],
      [nearestPoint[1], nearestPoint[0]],
    ];

    faultDistanceLine = L.polyline(latlngs, {
      color: "#005187",
      weight: 3,
      dashArray: "8, 6",
      opacity: 0.8,
      className: "animated-line",
    }).addTo(map);

    nearestFaultMarker = L.circleMarker([nearestPoint[1], nearestPoint[0]], {
      radius: 6,
      color: "#005187",
      fillColor: "#ff0000",
      fillOpacity: 0.8,
    })
      .addTo(map)
      .bindTooltip(`Nearest point on ${faultName}`, { sticky: true });

    setTimeout(() => {
      if (faultDistanceLine) map.removeLayer(faultDistanceLine);
      if (nearestFaultMarker) map.removeLayer(nearestFaultMarker);
      faultDistanceLine = null;
      nearestFaultMarker = null;
    }, FAULT_THRESHOLDS.LINE_DISPLAY_DURATION);
  }
  

  //  COUNTRY DATA FUNCTIONS
  /**
   * Loads country GeoJSON from remote repository and computes centroid coordinates
   * @returns {Promise<boolean>} Success status
   */
  async function loadCountriesFromGeoJSON() {
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
      );
      if (!response.ok) throw new Error("Failed to load GeoJSON");

      countryGeoJSON = await response.json();
      dynamicCountryData = {};

      countryGeoJSON.features.forEach((feature) => {
        const countryName =
          feature.properties?.ADMIN || feature.properties?.name;
        if (!countryName) return;

        let sumLat = 0,
          sumLng = 0,
          count = 0;
        const coords = feature.geometry.coordinates;

        const processPolygon = (polygon) => {
          if (polygon && polygon[0]) {
            polygon[0].forEach((coord) => {
              sumLat += coord[1];
              sumLng += coord[0];
              count++;
            });
          }
        };

        if (feature.geometry.type === "Polygon") {
          processPolygon(coords);
        } else if (feature.geometry.type === "MultiPolygon") {
          coords.forEach((polygon) => processPolygon(polygon));
        }

        if (count > 0) {
          dynamicCountryData[countryName] = {
            lat: sumLat / count,
            lng: sumLng / count,
            name: countryName,
            geometry: feature.geometry,
          };
        }
      });

      console.log(`Loaded ${Object.keys(dynamicCountryData).length} countries`);
      return true;
    } catch (error) {
      console.error("Error loading countries:", error);
      loadFallbackCountries();
      return false;
    }
  }

  /**
   * Provides fallback country data when GeoJSON fails to load
   */
  function loadFallbackCountries() {
    dynamicCountryData = {
      "United States": { lat: 39.8283, lng: -98.5795, name: "United States" },
      China: { lat: 35.8617, lng: 104.1954, name: "China" },
      Japan: { lat: 36.2048, lng: 138.2529, name: "Japan" },
      India: { lat: 20.5937, lng: 78.9629, name: "India" },
      Indonesia: { lat: -0.7893, lng: 113.9213, name: "Indonesia" },
      Italy: { lat: 41.8719, lng: 12.5674, name: "Italy" },
      Turkey: { lat: 38.9637, lng: 35.2433, name: "Turkey" },
      Iran: { lat: 32.4279, lng: 53.688, name: "Iran" },
      Pakistan: { lat: 30.3753, lng: 69.3451, name: "Pakistan" },
      Nepal: { lat: 28.3949, lng: 84.124, name: "Nepal" },
      Philippines: { lat: 12.8797, lng: 121.774, name: "Philippines" },
      Mexico: { lat: 23.6345, lng: -102.5528, name: "Mexico" },
      Peru: { lat: -9.19, lng: -75.0152, name: "Peru" },
      Chile: { lat: -35.6751, lng: -71.543, name: "Chile" },
      "New Zealand": { lat: -40.9006, lng: 174.886, name: "New Zealand" },
    };
  }

  /**
   * Populates the country dropdown select element
   */
  function populateCountryDropdown() {
    const countrySelect = document.getElementById("countrySelect");
    if (!countrySelect) return;

    while (countrySelect.options.length > 1) {
      countrySelect.remove(1);
    }

    Object.keys(dynamicCountryData)
      .sort()
      .forEach((country) => {
        const option = document.createElement("option");
        option.value = country;
        option.textContent = country;
        countrySelect.appendChild(option);
      });
  }

  //  MAP LAYER FUNCTIONS

  /**
   * Adds country boundary polygons to the map with tooltips
   */
  function addCountryBoundaries() {
    if (countryBoundaryLayer) {
      map.removeLayer(countryBoundaryLayer);
    }

    if (!countryGeoJSON) {
      console.warn("No country GeoJSON available");
      return;
    }

    countryBoundaryLayer = L.geoJSON(countryGeoJSON, {
      style: {
        color: "#2c3e50",
        weight: 1.2,
        fill: false,
        opacity: 0.8,
      },
      onEachFeature: function (feature, layer) {
        const countryName = feature.properties?.ADMIN || "Unknown";
        layer.bindTooltip(countryName, {
          sticky: true,
          className: "country-tooltip",
        });
        layer.on("click", function (e) {
          L.DomEvent.stopPropagation(e);
          const data = dynamicCountryData[countryName];
          if (data) {
            selectLocation(countryName, data.lat, data.lng, countryName);
          } else {
            const coords = e.latlng;
            selectLocation(countryName, coords.lat, coords.lng, countryName);
          }
        });
      },
    }).addTo(map);
    fixLayerOrder();
  }

  /**
   * Removes country boundary layer from map
   */
  function removeCountryBoundaries() {
    if (countryBoundaryLayer) {
      map.removeLayer(countryBoundaryLayer);
      countryBoundaryLayer = null;
    }
  }

  /**
   * Loads fault line data from TopoJSON file and converts to GeoJSON
   * @returns {Promise<void>}
   */
  async function loadFaultLines() {
    if (faultLayer || faultLoading) return;
    faultLoading = true;
    updateStatus("Loading fault lines...", false);

    try {
      const response = await fetch("data/faults.json");
      if (!response.ok) throw new Error("Failed to load fault data");

      const topoData = await response.json();
      const objectName = Object.keys(topoData.objects)[0];
      const geojsonData = topojson.feature(
        topoData,
        topoData.objects[objectName],
      );

      if (!geojsonData || !geojsonData.features) {
        throw new Error("Invalid GeoJSON conversion");
      }

      faultLayer = L.geoJSON(geojsonData, {
        renderer: L.canvas(),
        style: {
          color: "#005187",
          weight: 2,
          opacity: 0.85,
        },
        className: "fault-line",
        onEachFeature: function (feature, layer) {
          const props = feature.properties || {};
          const name =
            props.name || props.Name || props.fault_name || "Unnamed Fault";
          const slip = props.slip_type || props.slipType || "Unknown";

          layer.bindTooltip(`<strong>${name}</strong><br>Slip: ${slip}`, {
            className: "fault-tooltip",
            sticky: true,
          });

          layer.bindPopup(`<strong>${name}</strong><br>Slip Type: ${slip}`);
        },
      });

      console.log("Fault lines loaded");
      if (isFaultVisible && map.getZoom() >= CONFIG.faultZoomThreshold) {
        faultLayer.addTo(map);
      }
      updateStatus("Ready", true);
    } catch (error) {
      console.error("Error loading fault lines:", error);
      updateStatus("Fault lines unavailable", true);
    } finally {
      faultLoading = false;
    }
  }

  /**
   * Toggles fault line visibility based on zoom level threshold
   * @param {boolean} show - Whether to show fault lines
   */
  function toggleFaultLines(show) {
    isFaultVisible = show;
    const currentZoom = map.getZoom();
    const threshold = CONFIG.faultZoomThreshold;

    if (show) {
      if (currentZoom >= threshold) {
        if (!faultLayer && !faultLoading) {
          loadFaultLines();
        } else if (faultLayer && !map.hasLayer(faultLayer)) {
          faultLayer.addTo(map);
        }
      } else {
        updateStatus("Zoom in to see fault lines", false);
        setTimeout(() => {
          if (!isFaultVisible) return;
          updateStatus("Ready", true);
        }, 2000);
      }
    } else {
      if (faultLayer && map.hasLayer(faultLayer)) {
        map.removeLayer(faultLayer);
      }
    }
  }

  /**
   * Handles dynamic fault visibility on zoom change
   */
  function handleZoomForFaults() {
    if (!map) return;

    const currentZoom = map.getZoom();
    const threshold = CONFIG.faultZoomThreshold;

    if (isFaultVisible) {
      if (currentZoom >= threshold) {
        if (!faultLayer && !faultLoading) {
          loadFaultLines();
        } else if (faultLayer && !map.hasLayer(faultLayer)) {
          faultLayer.addTo(map);
        }
      } else {
        if (faultLayer && map.hasLayer(faultLayer)) {
          map.removeLayer(faultLayer);
        }
      }
    } else {
      if (faultLayer && map.hasLayer(faultLayer)) {
        map.removeLayer(faultLayer);
      }
    }
  }

  /**
   * Updates legend visibility based on hazard layer state
   */
  function handleLegendVisibility() {
    const legend = document.getElementById("legendSection");
    if (!legend) return;
    legend.style.display = isHazardVisible ? "block" : "none";
  }

  /**
   * Ensures proper z-index ordering of map layers
   */
  function fixLayerOrder() {
    if (hazardLayer) hazardLayer.bringToFront();
    if (countryBoundaryLayer) countryBoundaryLayer.bringToFront();
    if (faultLayer) faultLayer.bringToFront();
    if (currentMarker) currentMarker.setZIndexOffset(1000);
  }

  //  MAP INITIALIZATION

  /**
   * Adds custom zoom controls to replace default Leaflet zoom
   */
  function addCustomZoomControl() {
    const zoomControl = L.control({ position: "topleft" });
    zoomControl.onAdd = function () {
      const div = L.DomUtil.create("div", "custom-zoom-control");
      div.innerHTML = `
        <button class="zoom-in" aria-label="Zoom in">+</button>
        <button class="zoom-out" aria-label="Zoom out">−</button>
      `;
      L.DomEvent.disableClickPropagation(div);
      div
        .querySelector(".zoom-in")
        .addEventListener("click", () => map.zoomIn());
      div
        .querySelector(".zoom-out")
        .addEventListener("click", () => map.zoomOut());
      return div;
    };
    zoomControl.addTo(map);
  }

  /**
   * Creates the seismic hazard raster tile layer
   */
  function createHazardLayer() {
    if (hazardLayer) {
      map.removeLayer(hazardLayer);
    }

    hazardLayer = L.tileLayer(CONFIG.tilePath, {
      maxZoom: CONFIG.maxZoom,
      minZoom: CONFIG.minZoom,
      opacity: currentHazardOpacity,
      attribution: "Seismic Hazard: GEM Foundation",
      crossOrigin: "Anonymous",
      errorTileUrl: "",
      bounds: [
        [-60, -180],
        [84, 180],
      ],
    });

    hazardLayer.on("load", () => {
      updateStatus("Ready", true);
      tileErrorCount = 0;
    });

    hazardLayer.on("tileerror", (error) => {
      console.warn("Tile error:", error);
      tileErrorCount++;
      if (tileErrorCount === 1) {
        updateStatus("Loading tiles...", false);
      }
    });

    if (isHazardVisible) {
      hazardLayer.addTo(map);
    }
  }

  /**
   * Changes the base map (light, dark, satellite)
   * @param {string} type - Basemap type ('light', 'dark', 'satellite')
   */
  function changeBasemap(type) {
    if (currentBasemap) {
      map.removeLayer(currentBasemap);
    }

    let url, attribution;
    switch (type) {
      case "dark":
        url = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
        attribution = "&copy; OpenStreetMap &copy; CartoDB";
        break;
      case "satellite":
        url =
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
        attribution = "Tiles &copy; Esri";
        break;
      default:
        url = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
        attribution = "&copy; OpenStreetMap &copy; CartoDB";
    }

    currentBasemap = L.tileLayer(url, {
      attribution,
      subdomains: "abcd",
    }).addTo(map);

    fixLayerOrder();
  }

  /**
   * Toggles hazard layer visibility
   * @param {boolean} visible - Whether the hazard layer should be visible
   */
  function toggleHazardLayer(visible) {
    isHazardVisible = visible;

    if (hazardLayer) {
      if (visible) {
        if (!map.hasLayer(hazardLayer)) {
          hazardLayer.addTo(map);
        }
        hazardLayer.setOpacity(currentHazardOpacity);
      } else {
        map.removeLayer(hazardLayer);
      }
    }
  }

  /**
   * Updates hazard layer opacity
   * @param {number} value - Opacity value (0-1)
   */
  function updateHazardOpacity(value) {
    currentHazardOpacity = value;
    if (hazardLayer) {
      hazardLayer.setOpacity(value);
    }
  }

  /**
   * Builds the legend from PGA lookup table
   */
  function buildLegend() {
    const legendList = document.getElementById("legendList");
    if (!legendList) return;

    PGA_LOOKUP_TABLE.forEach((item) => {
      const legendItem = document.createElement("div");
      legendItem.className = "legend-item";
      legendItem.innerHTML = `
        <span class="color-box" style="background: rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]});"></span>
        <span class="legend-range">${item.min.toFixed(2)} - ${item.max.toFixed(2)} g</span>
        <span class="legend-level">${item.level}</span>
      `;
      legendList.appendChild(legendItem);
    });
  }

  /**
   * Initializes the Leaflet map with default settings
   */
  function initMap() {
    map = L.map("map", {
      center: CONFIG.defaultCenter,
      zoom: CONFIG.defaultZoom,
      minZoom: CONFIG.minZoom,
      maxZoom: CONFIG.maxZoom,
      maxBounds: CONFIG.maxBounds,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
    });

    addCustomZoomControl();
    currentBasemap = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors &copy; CartoDB',
        subdomains: "abcd",
      },
    ).addTo(map);

    createHazardLayer();
    L.control
      .scale({ imperial: false, metric: true, position: "bottomleft" })
      .addTo(map);
    updateStatus("Ready", true);
  }

  //  LOCATION & SEARCH FUNCTIONS

  /**
   * Searches for locations using Nominatim geocoding API
   * @param {string} query - Search query (city, country, address)
   * @returns {Promise<Array>} Array of location results
   */
  async function searchNominatim(query) {
    if (!query || query.length < 2) return [];

    if (currentNominatimController) {
      currentNominatimController.abort();
    }

    const controller = new AbortController();
    currentNominatimController = controller;

    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: 8,
        addressdetails: 1,
        "accept-language": "en",
      });

      const response = await fetch(
        `${CONFIG.nominatimEndpoint}?${params.toString()}`,
        {
          signal: controller.signal,
          headers: { "User-Agent": CONFIG.userAgent },
        },
      );

      if (!response.ok) throw new Error("Nominatim request failed");

      const data = await response.json();
      currentNominatimController = null;

      return data.map((item) => ({
        type: "nominatim",
        name: item.display_name.split(",")[0],
        fullName: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        category: item.category || item.type,
      }));
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Nominatim error:", error);
      }
      return [];
    }
  }

  /**
   * Updates the stats card and risk panel with selected location data
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {Object} hazard - Hazard information (PGA, level)
   * @param {Object} faultInfo - Fault distance information
   * @param {string} displayName - Display name for the location
   */
  function updateStatsAndRiskPanel(lat, lng, hazard, faultInfo, displayName) {
    const hazardText = hazard ? hazard.pga.toFixed(3) : "--";
    const hazardLevel = hazard ? hazard.level : "--";

    // Update stats card
    const statPGA = document.getElementById("statPGA");
    const statLevel = document.getElementById("statLevel");
    const statCoords = document.getElementById("statCoords");
    const statFault = document.getElementById("statFault");
    const statDistance = document.getElementById("statDistance");
    const statsCard = document.getElementById("statsCard");

    if (statPGA) statPGA.textContent = hazardText;
    if (statLevel) statLevel.textContent = hazardLevel;
    if (statCoords) statCoords.textContent = formatCoordinates(lat, lng);

    if (statFault && faultInfo.nearestFault) {
      statFault.textContent = faultInfo.nearestFault;
    } else if (statFault) {
      statFault.textContent = "No fault data";
    }

    if (statDistance && faultInfo.distance !== null) {
      statDistance.textContent = `${faultInfo.distance.toFixed(2)} km`;
    } else if (statDistance) {
      statDistance.textContent = "--";
    }

    if (statsCard) statsCard.style.display = "block";

    // Update risk panel
    const riskPGA = document.getElementById("riskPGA");
    const riskFault = document.getElementById("riskFault");

    if (riskPGA) riskPGA.textContent = hazardText;
    if (riskFault && faultInfo.nearestFault) {
      riskFault.textContent = `${faultInfo.nearestFault} (${faultInfo.distance ? faultInfo.distance.toFixed(1) : "?"} km)`;
    } else if (riskFault) {
      riskFault.textContent = "No fault data";
    }

    // Auto-expand the risk panel when a location is selected
    const riskPanel = document.getElementById("riskPanelFloating");
    const toggleBtn = document.getElementById("toggleRiskPanel");
    if (riskPanel && toggleBtn) {
      riskPanel.classList.remove("collapsed");
      toggleBtn.textContent = "−";
      toggleBtn.disabled = false;
      toggleBtn.classList.add("active");
    }

    setFormDisabled(!hazard);
  }

  /**
   * Selects a location, centers map, and fetches hazard and fault data
   * @param {string} name - Location name
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {string} country - Country name (optional)
   * @param {string} fullAddress - Full address (optional)
   */
  async function selectLocation(
    name,
    lat,
    lng,
    country = "",
    fullAddress = "",
  ) {
    // Remove existing marker
    if (currentMarker) {
      map.removeLayer(currentMarker);
    }

    // Add new marker with pulse effect
    currentMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "custom-marker pulse-marker",
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      }),
    }).addTo(map);

    updateStatus("Fetching hazard data...", false);
    const hazard = await getHazardFromRaster(lat, lng);

    updateStatus("Ready", true);

    const faultInfo = calculateDistanceToNearestFault(lat, lng);
    currentFaultInfo = faultInfo;

    const displayName = fullAddress || name;
    updateStatsAndRiskPanel(lat, lng, hazard, faultInfo, displayName);

    // Build popup content
    let faultHtml = "";
    if (faultInfo.distance !== null) {
      faultHtml = `<br><span style="color: #ff3b2f;">⚡ Nearest Fault: ${faultInfo.nearestFault}</span><br>
                   <span>📏 Distance: ${faultInfo.distance.toFixed(2)} km</span><br>
                   <span style="font-size: 0.8rem;">${faultInfo.message}</span>`;
    }

    const popupContent = `
      <strong>${escapeHtml(displayName)}</strong>${country ? `<br>${escapeHtml(country)}` : ""}<br>
      ${formatCoordinates(lat, lng)}<br>
      ${
        hazard
          ? `<span style="color: #d43f1a; font-weight: bold;">PGA: ${hazard.pga.toFixed(3)} g</span><br>
           <span>Hazard Level: ${hazard.level}</span>`
          : `<span style="color: gray;">No seismic hazard data (ocean area)</span>`
      }
      ${faultHtml}
    `;

    currentMarker.bindPopup(popupContent).openPopup();
    map.flyTo([lat, lng], CONFIG.flyToZoom, { duration: CONFIG.flyToDuration });

    setTimeout(() => {
      handleZoomForFaults();
    }, 300);

    if (faultInfo.distance !== null && faultInfo.nearestPoint) {
      showFaultDistanceLine(
        [lng, lat],
        faultInfo.nearestPoint,
        faultInfo.nearestFault,
      );
    }

    fixLayerOrder();
  }

  //  SEARCH UI HANDLERS

  /**
   * Sets up the location search input with autocomplete
   */
  function setupSearch() {
    const searchInput = document.getElementById("searchInput");
    const searchResults = document.getElementById("searchResults");
    const clearSearchBtn = document.getElementById("clearSearchBtn");

    if (!searchInput || !searchResults) return;

    let searchDebounceTimer;

    /**
     * Performs search against country data and Nominatim
     * @param {string} query - Search query
     * @returns {Promise<Array>} Search results
     */
    async function performSearch(query) {
      if (!query || query.length < 2) return [];

      const results = [];
      const trimmedQuery = query.trim();

      // Check for coordinate input
      const coordMatch = trimmedQuery.match(
        /^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/,
      );
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (
          !isNaN(lat) &&
          !isNaN(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
        ) {
          results.push({
            type: "coordinate",
            name: `Coordinates: ${formatCoordinates(lat, lng)}`,
            lat,
            lng,
            fullName: `${lat}, ${lng}`,
          });
        }
      }

      // Search in country data
      const lowerQuery = trimmedQuery.toLowerCase();
      for (const [country, data] of Object.entries(dynamicCountryData)) {
        if (country.toLowerCase().includes(lowerQuery) && results.length < 5) {
          results.push({
            type: "country",
            name: country,
            lat: data.lat,
            lng: data.lng,
            fullName: country,
          });
        }
      }

      // Search via Nominatim
      const nominatimResults = await searchNominatim(trimmedQuery);
      for (const item of nominatimResults) {
        if (!results.some((r) => Math.abs(r.lat - item.lat) < 0.01)) {
          results.push(item);
        }
      }

      return results.slice(0, 10);
    }

    /**
     * Displays search results in the dropdown
     * @param {Array} results - Search results
     */
    function displayResults(results) {
      if (!results.length) {
        searchResults.innerHTML =
          '<div class="no-results">No locations found. Try a city, country, or coordinates.</div>';
        searchResults.classList.add("show");
        return;
      }

      searchResults.innerHTML = results
        .map((r, i) => {
          const icon =
            r.type === "country" ? "🌍" : r.type === "coordinate" ? "📍" : "🏙️";
          return `
            <div class="result-item" data-index="${i}">
              <div class="result-icon">${icon}</div>
              <div class="result-content">
                <div class="result-name">${escapeHtml(r.name)}</div>
                <div class="result-coords">${r.lat.toFixed(4)}°, ${r.lng.toFixed(4)}°</div>
              </div>
            </div>
          `;
        })
        .join("");
      searchResults.classList.add("show");

      document.querySelectorAll(".result-item").forEach((el) => {
        el.addEventListener("click", async () => {
          const idx = parseInt(el.dataset.index);
          const r = results[idx];
          if (r) {
            await selectLocation(
              r.name,
              r.lat,
              r.lng,
              "",
              r.fullName || r.name,
            );
            searchInput.value = r.fullName || r.name;
            searchResults.classList.remove("show");
            if (clearSearchBtn) clearSearchBtn.style.display = "flex";
          }
        });
      });
    }

    // Input event handler with debounce
    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounceTimer);
      const query = this.value.trim();
      if (clearSearchBtn)
        clearSearchBtn.style.display = query ? "flex" : "none";

      if (query.length < 2) {
        searchResults.classList.remove("show");
        return;
      }

      searchDebounceTimer = setTimeout(async () => {
        const results = await performSearch(query);
        displayResults(results);
      }, 400);
    });

    // Clear button handler
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        clearSearchBtn.style.display = "none";
        searchResults.classList.remove("show");
        searchInput.focus();
      });
    }

    // Enter key handler
    searchInput.addEventListener("keypress", async (e) => {
      if (e.key === "Enter") {
        const query = searchInput.value.trim();
        if (query.length >= 2) {
          const results = await performSearch(query);
          if (results.length > 0) {
            const first = results[0];
            await selectLocation(
              first.name,
              first.lat,
              first.lng,
              "",
              first.fullName || first.name,
            );
            searchInput.value = first.fullName || first.name;
            searchResults.classList.remove("show");
          }
        }
      }
    });

    // Close results when clicking outside
    document.addEventListener("click", (e) => {
      if (
        !searchInput.contains(e.target) &&
        !searchResults.contains(e.target)
      ) {
        searchResults.classList.remove("show");
      }
    });
  }

  //  RISK ANALYSIS UI

  /**
   * Sets up the risk analysis panel with dynamic document section visibility
   */
  function setupRiskAnalysis() {
    const analyzeBtn = document.getElementById("analyzeBtn");
    if (!analyzeBtn) return;

    const propertyTypeSelect = document.getElementById("propertyType");
    const documentsSection = document.getElementById("documentsSection");
    const leaseRenewalQuestion = document.getElementById(
      "leaseRenewalQuestion",
    );
    const seismicAssessmentDone = document.getElementById(
      "seismicAssessmentDone",
    );

    /**
     * Updates document section visibility based on property type and assessment status
     */
    function updateDocumentSections() {
      const propertyType = propertyTypeSelect?.value || "";
      const seismicValue = seismicAssessmentDone?.value || "";

      if (documentsSection) documentsSection.style.display = "none";
      if (leaseRenewalQuestion) leaseRenewalQuestion.style.display = "none";

      if (propertyType === "New Lease") {
        if (documentsSection) documentsSection.style.display = "block";
      } else if (propertyType === "Lease Renewal") {
        if (leaseRenewalQuestion) leaseRenewalQuestion.style.display = "block";
        if (seismicValue === "no") {
          if (documentsSection) documentsSection.style.display = "block";
        }
      } else if (propertyType === "Building Acquisition") {
        if (documentsSection) documentsSection.style.display = "block";
      }
    }

    if (propertyTypeSelect) {
      propertyTypeSelect.addEventListener("change", updateDocumentSections);
    }
    if (seismicAssessmentDone) {
      seismicAssessmentDone.addEventListener("change", updateDocumentSections);
    }

    updateDocumentSections();

    /**
     * Gets selected document checkboxes
     * @returns {Array} Array of selected document values
     */
    function getSelectedDocuments() {
      const documentCheckboxes = document.querySelectorAll(
        '.documents-option input[type="checkbox"]',
      );
      return Array.from(documentCheckboxes)
        .filter((cb) => cb.checked)
        .map((cb) => cb.value);
    }

    /**
     * Validates if property type qualifies for document-based recommendations
     * @param {string} propertyType - Property type
     * @param {string} seismicValue - Seismic assessment value
     * @returns {boolean} Whether valid
     */
    function isValidPropertyType(propertyType, seismicValue) {
      if (propertyType === "New Lease") return true;
      if (propertyType === "Building Acquisition") return true;
      if (propertyType === "Lease Renewal" && seismicValue === "no")
        return true;
      return false;
    }

    /**
     * Returns seismicity category based on PGA value
     * @param {number} pga - Peak Ground Acceleration
     * @returns {string|null} Seismicity category
     */
    function getSeismicityCategory(pga) {
      if (pga >= 0.01 && pga < 0.03) return "low";
      if (pga >= 0.03 && pga <= 0.08) return "moderate";
      if (pga > 0.08) return "high";
      return null;
    }

    /**
     * Returns display string for seismicity
     * @param {number} pga - Peak Ground Acceleration
     * @returns {string} Display string
     */
    function getSeismicityDisplay(pga) {
      if (pga >= 0.01 && pga < 0.03) return "Low (0.01g - < 0.03g)";
      if (pga >= 0.03 && pga <0.08) return "Moderate (0.03g - < 0.08g)";
      if (pga >= 0.08) return "High (&ge; 0.08g)";
      return "Unknown";
    }

    /**
     * Returns building type display name
     * @param {string} buildingType - Building type code
     * @returns {string} Display name
     */
    function getBuildingTypeName(buildingType) {
      return buildingType === "URM"
        ? "Unreinforced Masonry (URM) / Wood"
        : "RC Frame / Shear Wall / Steel";
    }

    // Main analysis logic
    analyzeBtn.addEventListener("click", () => {
      const pgaElement = document.getElementById("statPGA");
      let pga = parseFloat(pgaElement ? pgaElement.textContent : "NaN");
      const riskResult = document.getElementById("riskResult");

      if (isNaN(pga)) {
        if (riskResult) {
          riskResult.innerHTML =
            "⚠️ PGA value is less than 0.01g";
          riskResult.style.color = "orange";
        }
        setFormDisabled(true);
        return;
      }
      setFormDisabled(false);

      if (pga < 0.01) {
        if (riskResult) {
          riskResult.innerHTML =
            "⚠️ PGA value is less than 0.01g";
          riskResult.style.color = "#3498db";
        }
        return;
      }

      const buildingType = document.getElementById("buildingType").value;
      const storiesInputRaw = document.getElementById("buildingStories").value;
      const storiesInput = storiesInputRaw.trim();

      const propertyType = propertyTypeSelect ? propertyTypeSelect.value : "";
      if (!propertyType) {
        riskResult.innerHTML = "⚠️ Please select a property type.";
        riskResult.style.color = "orange";
        return;
      }

      if (!buildingType) {
        if (riskResult) {
          riskResult.innerHTML = "⚠️ Please select a building type.";
          riskResult.style.color = "orange";
        }
        return;
      }

      // Empty check
      if (!storiesInput) {
        riskResult.innerHTML = "⚠️ Please enter number of stories.";
        riskResult.style.color = "orange";
        return;
      }

      // Convert
      const stories = Number(storiesInput);

      // Strict validation
      if (!Number.isInteger(stories) || stories <= 0) {
        riskResult.innerHTML =
          "⚠️ Number of stories must be a positive whole number.";
        riskResult.style.color = "orange";
        return;
      }
      
      const seismicValue = seismicAssessmentDone
        ? seismicAssessmentDone.value
        : "";

      

      const seismicityCategory = getSeismicityCategory(pga);
      const seismicityDisplay = getSeismicityDisplay(pga);
      const selectedDocuments = getSelectedDocuments();

      const hasStructuralDesignReport = selectedDocuments.includes(
        "Structural design report",
      );
      const hasArchitecturalDrawings = selectedDocuments.includes(
        "Architectural drawings",
      );
      const hasStructuralAsBuilt = selectedDocuments.includes(
        "Structural as-built drawings",
      );
      const hasDigitalModel = selectedDocuments.includes(
        "Digital structural model (ETABS or equivalent)",
      );
      const hasGeotechnicalReport = selectedDocuments.includes(
        "Geotechnical report",
      );
      const hasFloorPlan = selectedDocuments.includes(
        "Floor plan showing structural columns and walls location",
      );

      const hasPeerReviewDocuments =  hasStructuralDesignReport &&  hasArchitecturalDrawings &&  hasStructuralAsBuilt &&  hasDigitalModel;
      const hasOnlyStructuralReport =  hasStructuralDesignReport &&  !hasArchitecturalDrawings &&  !hasStructuralAsBuilt &&  !hasDigitalModel &&  !hasGeotechnicalReport &&  !hasFloorPlan;
      const hasTier3Documents = hasArchitecturalDrawings && hasStructuralAsBuilt && hasGeotechnicalReport;
      const tier3DocCount =
  (hasArchitecturalDrawings ? 1 : 0) +
  (hasStructuralAsBuilt ? 1 : 0) +
  (hasGeotechnicalReport ? 1 : 0);

const isOnlyAsBuilt =
  hasStructuralAsBuilt &&
  !hasArchitecturalDrawings &&
  !hasGeotechnicalReport;

const hasAnyTier3Combo =
  tier3DocCount >= 2 || 
  (tier3DocCount === 1 && !isOnlyAsBuilt);

  const tier1DocCount =
  (hasStructuralAsBuilt ? 1 : 0) +
  (hasFloorPlan ? 1 : 0);

const hasStrongTier1Docs =
  hasStructuralAsBuilt && hasFloorPlan;

const hasWeakTier1Docs =
  tier1DocCount === 1; // only one of them

      const hasTier1Documents = hasStructuralAsBuilt || hasFloorPlan;
      
      const isValidForDocs = isValidPropertyType(propertyType, seismicValue);

      let recommendation = "";
      let recommendationType = "";
      let logicMatched = false;

      // Condition 5: Lease Renewal with Yes assessment
      if (propertyType === "Lease Renewal" && seismicValue === "yes") {
        recommendation = "Submit Document";
        recommendationType = "tier2";
        logicMatched = true;
      }

      // ----------------------
// STEP 2: PEER REVIEW
// ----------------------
else if (hasPeerReviewDocuments) {
  recommendation = "Peer Review – See Note 2";
  recommendationType = "tier2";
  logicMatched = true;
}

// ----------------------
// STEP 3: HIGH-LEVEL REVIEW
// ----------------------
else if (hasOnlyStructuralReport) {
  recommendation = "High-Level Review – See Note 1";
  recommendationType = "tier1";
  logicMatched = true;
}

      // ----------------------
// STEP 4: TIER 3 (UPDATED)
// ----------------------
else if (hasAnyTier3Combo) {

  let baseRecommendation = "";
  let note = "";

  // Full documents → no warning
  if (tier3DocCount === 3) {
    note = "";
  } 
  // Partial documents → show warning
  else {
    note = " (Insufficient Document)";
  }

  // URM
  if (buildingType === "URM" && pga > 0.01) {
    baseRecommendation = "ASCE41 Tier 3 - See Note 4";
  }

  // RC
  else if (buildingType === "RC") {

    if (pga >= 0.03 && pga <= 0.08 && stories >= 13) {
      baseRecommendation = "ASCE41 Tier 3 - See Note 4";
    }

    else if (pga > 0.08 && stories >= 9) {
      baseRecommendation = "ASCE41 Tier 3 - See Note 4";
    }

    else {
      baseRecommendation = "Insufficient Document";
    }
  }

  // Final output
  recommendation = baseRecommendation + note;
  recommendationType = "tier3";
  logicMatched = true;
}

      // ----------------------
// STEP 5: TIER 1 (UPDATED)
// ----------------------
else if (hasTier1Documents) {

  let baseRecommendation = "";
  let note = "";

  // Weak docs → add warning
  if (hasWeakTier1Docs) {
    note = " (Insufficient Document)";
  }

  // RC only (as per your logic)
  if (buildingType === "RC") {

    if (pga >= 0.01 && pga < 0.03) {
      baseRecommendation = "ASCE41 Tier 1 - See Note 3";
    }

    else if (pga >= 0.03 && pga <= 0.08 && stories <= 12) {
      baseRecommendation = "ASCE41 Tier 1 - See Note 3";
    }

    else if (pga > 0.08 && stories <= 9) {
      baseRecommendation = "ASCE41 Tier 1 - See Note 3";
    }

    else {
      baseRecommendation = "Insufficient Document";
      note = "";
    }
  }

  // URM fallback (optional but safer)
  else if (buildingType === "URM") {
    baseRecommendation = "ASCE41 Tier 1 - See Note 3";
  }

  recommendation = baseRecommendation + note;
  recommendationType = "tier1";
  logicMatched = true;
}
      
      

      if (!logicMatched) {
        recommendation =
          "Available documentation is not sufficient. Please see Notes Sheet to see the list of required documentation for each type of analysis.";
        recommendationType = "tier2";
      }

      const color =
        recommendationType === "tier3"
          ? "#e74c3c"
          : recommendationType === "tier2"
            ? "#f39c12"
            : "#2ecc71";

      if (riskResult) {
        riskResult.innerHTML = `
          <div style="background: #f8fafc; border-radius: 12px; padding: 14px; border-left: 4px solid ${color}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #5a6e7c; font-weight: 500;">📍 Location PGA</span>
              <span style="color: #1a2a3a; font-weight: 600; font-family: monospace;">${pga.toFixed(4)} g</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #5a6e7c; font-weight: 500;">🏗️ Building Type</span>
              <span style="color: #1a2a3a; font-weight: 600;">${getBuildingTypeName(buildingType)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #5a6e7c; font-weight: 500;">📏 Stories</span>
              <span style="color: #1a2a3a; font-weight: 600;">${stories}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #5a6e7c; font-weight: 500;">🏢 Property Type</span>
              <span style="color: #1a2a3a; font-weight: 600;">${propertyType || "Not selected"}</span>
            </div>
            ${
              propertyType === "Lease Renewal"
                ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #5a6e7c; font-weight: 500;">📋 Seismic Assessment Done by WB</span>
              <span style="color: #1a2a3a; font-weight: 600;">${seismicValue === "yes" ? "Yes" : seismicValue === "no" ? "No" : "Not selected"}</span>
            </div>
            `
                : ""
            }
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #5a6e7c; font-weight: 500;">🌊 Seismicity</span>
              <span style="color: #1a2a3a; font-weight: 600;">${seismicityDisplay}</span>
            </div>
            ${
              selectedDocuments.length > 0
                ? `
            <div style="margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #5a6e7c; font-weight: 500;">📄 Available Documents:</span>
              <ul style="margin-top: 6px; margin-bottom: 0; padding-left: 20px; font-size: 0.75rem; color: #1a2a3a;">
                ${selectedDocuments.map((doc) => `<li>${escapeHtml(doc)}</li>`).join("")}
              </ul>
            </div>
            `
                : ""
            }
            <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center;">
              <strong style="color: ${color}; font-size: 0.9rem;">${recommendation}</strong>
            </div>
          </div>
        `;
      }
    });
  }

  /**
   * Sets up the risk panel collapse/expand toggle
   */
  function setupRiskPanelToggle() {
    const riskPanel = document.getElementById("riskPanelFloating");
    const toggleBtn = document.getElementById("toggleRiskPanel");

    if (riskPanel && toggleBtn) {
      riskPanel.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        riskPanel.classList.toggle("collapsed");
        toggleBtn.textContent = riskPanel.classList.contains("collapsed")
          ? "+"
          : "−";
      });
      toggleBtn.disabled = true;
      toggleBtn.classList.remove("active");
    }
  }

  //  EVENT HANDLERS

  /**
   * Sets up all map and UI event listeners
   */
  function setupEventListeners() {
    // Reset view button
    const resetBtn = document.getElementById("resetViewBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        map.flyTo(CONFIG.defaultCenter, CONFIG.defaultZoom, {
          duration: CONFIG.flyToDuration,
        });

        setTimeout(() => {
          handleZoomForFaults();
        }, 300);

        if (currentMarker) {
          map.removeLayer(currentMarker);
          currentMarker = null;
        }

        const searchInput = document.getElementById("searchInput");
        const clearSearchBtn = document.getElementById("clearSearchBtn");
        if (searchInput) searchInput.value = "";
        if (clearSearchBtn) clearSearchBtn.style.display = "none";

        const countrySelect = document.getElementById("countrySelect");
        if (countrySelect) countrySelect.value = "";

        const statsCard = document.getElementById("statsCard");
        if (statsCard) statsCard.style.display = "none";

        const riskResult = document.getElementById("riskResult");
        if (riskResult) riskResult.innerHTML = "";

        const riskPGA = document.getElementById("riskPGA");
        if (riskPGA) riskPGA.textContent = "--";

        const riskFault = document.getElementById("riskFault");
        if (riskFault) riskFault.textContent = "--";

        // Reset all Risk Analysis Panel fields
        const propertyType = document.getElementById("propertyType");
        if (propertyType) propertyType.value = "";

        const documentsSection = document.getElementById("documentsSection");
        if (documentsSection) documentsSection.style.display = "none";

        const documentCheckboxes = document.querySelectorAll(
          '.documents-option input[type="checkbox"]',
        );
        documentCheckboxes.forEach((checkbox) => {
          checkbox.checked = false;
        });

        const leaseRenewalQuestion = document.getElementById(
          "leaseRenewalQuestion",
        );
        if (leaseRenewalQuestion) leaseRenewalQuestion.style.display = "none";

        const seismicAssessmentDone = document.getElementById(
          "seismicAssessmentDone",
        );
        if (seismicAssessmentDone) seismicAssessmentDone.value = "";

        const buildingType = document.getElementById("buildingType");
        if (buildingType) buildingType.value = "";

        const buildingStories = document.getElementById("buildingStories");
        if (buildingStories) buildingStories.value = "";

        const riskPanel = document.getElementById("riskPanelFloating");
        const toggleBtn = document.getElementById("toggleRiskPanel");
        if (riskPanel && toggleBtn) {
          riskPanel.classList.add("collapsed");
          toggleBtn.textContent = "+";
          toggleBtn.disabled = true;
          toggleBtn.classList.remove("active");
        }

        currentFaultInfo = null;
      });
    }

    // Current location button
    const locationBtn = document.getElementById("currentLocationBtn");
    if (locationBtn) {
      locationBtn.addEventListener("click", function () {
        if (navigator.geolocation) {
          const originalHTML = this.innerHTML;
          this.innerHTML =
            '<div style="width:20px;height:20px;border:2px solid white;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>';
          this.disabled = true;

          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              await selectLocation(
                "Your Location",
                pos.coords.latitude,
                pos.coords.longitude,
                "",
              );
              this.innerHTML = originalHTML;
              this.disabled = false;
            },
            () => {
              alert("Unable to get your location. Please check permissions.");
              this.innerHTML = originalHTML;
              this.disabled = false;
            },
          );
        } else {
          alert("Geolocation is not supported by your browser");
        }
      });
    }

    // Country select dropdown
    const countrySelect = document.getElementById("countrySelect");
    if (countrySelect) {
      countrySelect.addEventListener("change", async function () {
        const country = this.value;
        if (country && dynamicCountryData[country]) {
          const data = dynamicCountryData[country];
          await selectLocation(country, data.lat, data.lng, country);
        }
      });
    }

    // Layer panel toggle
    const panelToggle = document.getElementById("layerPanelToggle");
    const layerPanel = document.getElementById("layerPanel");
    if (panelToggle && layerPanel) {
      panelToggle.addEventListener("click", () => {
        layerPanel.classList.toggle("collapsed");
        panelToggle.textContent = layerPanel.classList.contains("collapsed")
          ? "+"
          : "−";
      });
    }

    // Basemap radio buttons
    document.querySelectorAll('input[name="basemap"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        if (e.target.checked) changeBasemap(e.target.value);
      });
    });

    // Hazard layer toggle
    const hazardToggle = document.getElementById("hazardLayerToggle");
    const opacityControl = document.getElementById("opacityControl");
    if (hazardToggle) {
      hazardToggle.addEventListener("change", (e) => {
        toggleHazardLayer(e.target.checked);
        if (opacityControl)
          opacityControl.style.display = e.target.checked ? "flex" : "none";
        handleLegendVisibility();
      });
    }

    // Country boundary toggle
    const boundaryToggle = document.getElementById("countryBoundaryToggle");
    if (boundaryToggle) {
      boundaryToggle.addEventListener("change", (e) => {
        if (e.target.checked) addCountryBoundaries();
        else removeCountryBoundaries();
      });
    }

    // Fault lines toggle
    const faultToggle = document.getElementById("faultLinesToggle");
    if (faultToggle) {
      faultToggle.addEventListener("change", (e) => {
        toggleFaultLines(e.target.checked);
      });
    }

    // Opacity slider
    const opacitySlider = document.getElementById("opacitySlider");
    if (opacitySlider) {
      opacitySlider.addEventListener("input", (e) => {
        updateHazardOpacity(e.target.value / 100);
      });
    }

    // Map zoom events
    map.on("zoomend", handleZoomForFaults);
    map.on("zoomend", handleLegendVisibility);

    // Map click handler
    map.on("click", async (e) => {
      const { lat, lng } = e.latlng;
      showClickAnimation(lat, lng);
      await selectLocation("Selected Location", lat, lng, "");
    });

    // Mouse move coordinates display
    map.on("mousemove", (e) => {
      const coordsDisplay = document.getElementById("coordsDisplay");
      if (coordsDisplay) {
        coordsDisplay.innerHTML = `<span>Lat: ${e.latlng.lat.toFixed(4)}°</span><span>Lng: ${e.latlng.lng.toFixed(4)}°</span>`;
      }
    });
  }

  //  INITIALIZATION

  /**
   * Initializes the application
   */
  async function init() {
    console.log("Initializing Seismic Hazard Map with local tiles...");
    console.log(
      'Place your hazard tiles in the "tiles" folder with structure: tiles/{z}/{x}/{y}.png',
    );

    initMap();
    buildLegend();
    await loadCountriesFromGeoJSON();
    populateCountryDropdown();
    addCountryBoundaries();
    setupEventListeners();
    setupSearch();
    setupRiskAnalysis();
    setupRiskPanelToggle();
    handleZoomForFaults();
    handleLegendVisibility();
    updateStatus("Ready", true);
  }

  // Start the application
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
