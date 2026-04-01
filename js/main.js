/**
 * Global Seismic Hazard Map - Professional Version (Robust)
 * GEM Foundation v2023.1
 * Handles map visualization, location search, and seismic hazard data display
 * Supports local tile loading from 'tiles' folder
 */

(function () {
    'use strict';

    // ==================== CONFIGURATION ====================
    const CONFIG = {
        defaultCenter: [20, 0],
        defaultZoom: 2,
        minZoom: 2,
        maxZoom: 6,
        maxBounds: [[-60, -180], [84, 180]],
        tilePath: 'tiles/{z}/{x}/{y}.png',
        hazardOpacity: 0.75,
        flyToZoom: 6,
        flyToDuration: 1.2,
        nominatimEndpoint: 'https://nominatim.openstreetmap.org/search',
        userAgent: 'SeismicHazardMap/1.0',
        faultZoomThreshold: 5
    };

    // PGA Color Lookup Table
    const PGA_LOOKUP_TABLE = [
        { color: [255, 255, 255], min: 0.00, max: 0.01, level: "Very Low", rgbKey: "255,255,255" },
        { color: [215, 227, 238], min: 0.01, max: 0.02, level: "Low", rgbKey: "215,227,238" },
        { color: [181, 202, 255], min: 0.02, max: 0.03, level: "Low-Moderate", rgbKey: "181,202,255" },
        { color: [143, 179, 255], min: 0.03, max: 0.05, level: "Moderate", rgbKey: "143,179,255" },
        { color: [127, 151, 255], min: 0.05, max: 0.08, level: "Moderate-High", rgbKey: "127,151,255" },
        { color: [171, 207, 99], min: 0.08, max: 0.13, level: "High", rgbKey: "171,207,99" },
        { color: [232, 245, 158], min: 0.13, max: 0.20, level: "High", rgbKey: "232,245,158" },
        { color: [255, 250, 20], min: 0.20, max: 0.35, level: "Very High", rgbKey: "255,250,20" },
        { color: [255, 209, 33], min: 0.35, max: 0.55, level: "Very High", rgbKey: "255,209,33" },
        { color: [255, 163, 10], min: 0.55, max: 0.90, level: "Extreme", rgbKey: "255,163,10" },
        { color: [255, 76, 0], min: 0.90, max: 1.50, level: "Extreme", rgbKey: "255,76,0" }
    ];

    const RGB_TO_HAZARD = new Map();
    PGA_LOOKUP_TABLE.forEach(item => {
        RGB_TO_HAZARD.set(item.rgbKey, item);
    });

    // Global variables
    let map, currentMarker, hazardLayer, currentBasemap, countryBoundaryLayer, faultLayer = null;
    let currentHazardOpacity = CONFIG.hazardOpacity;
    let isHazardVisible = true;
    let isFaultVisible = false;
    let dynamicCountryData = {};
    let countryGeoJSON = null;
    let currentNominatimRequest = null;
    let faultLoading = false;
    let tileErrorCount = 0;

    // ==================== HELPER FUNCTIONS ====================
    function formatCoordinates(lat, lng) {
        return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function updateStatus(text, isReady) {
        const statusText = document.getElementById('statusText');
        const statusDot = document.querySelector('.status-dot');
        if (statusText) statusText.textContent = text;
        if (statusDot) {
            if (isReady) statusDot.classList.add('active');
            else statusDot.classList.remove('active');
        }
    }

    // ==================== HAZARD LOOKUP ====================
    async function getHazardFromRaster(lat, lng) {
        return new Promise((resolve) => {
            try {
                const currentZoom = Math.min(map.getZoom(), CONFIG.maxZoom);
                const point = map.project([lat, lng], currentZoom);
                const tileSize = 256;
                const tileX = Math.floor(point.x / tileSize);
                const tileY = Math.floor(point.y / tileSize);

                const tileUrl = CONFIG.tilePath
                    .replace('{z}', currentZoom)
                    .replace('{x}', tileX)
                    .replace('{y}', tileY);

                const img = new Image();
                img.crossOrigin = "Anonymous";

                const timeoutId = setTimeout(() => {
                    console.warn('Tile load timeout, using estimate');
                    resolve(getHazardEstimate(lat, lng));
                }, 3000);

                img.onload = function () {
                    clearTimeout(timeoutId);
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = tileSize;
                        canvas.height = tileSize;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        const pixelX = Math.floor(point.x % tileSize);
                        const pixelY = Math.floor(point.y % tileSize);

                        const imageData = ctx.getImageData(pixelX, pixelY, 1, 1);
                        const r = imageData.data[0];
                        const g = imageData.data[1];
                        const b = imageData.data[2];

                        if (imageData.data[3] === 0 || (r === 255 && g === 255 && b === 255)) {
                            resolve(getHazardEstimate(lat, lng));
                            return;
                        }

                        const rgbKey = `${r},${g},${b}`;
                        const hazardInfo = RGB_TO_HAZARD.get(rgbKey);

                        if (hazardInfo) {
                            resolve({
                                pga: (hazardInfo.min + hazardInfo.max) / 2,
                                level: hazardInfo.level,
                                min: hazardInfo.min,
                                max: hazardInfo.max
                            });
                        } else {
                            resolve(findClosestHazard(r, g, b));
                        }
                    } catch (err) {
                        console.error('Error reading tile pixel:', err);
                        resolve(getHazardEstimate(lat, lng));
                    }
                };

                img.onerror = function () {
                    clearTimeout(timeoutId);
                    tileErrorCount++;
                    if (tileErrorCount > 10) {
                        console.warn('Multiple tile loading errors, using estimates');
                        tileErrorCount = 0;
                    }
                    resolve(getHazardEstimate(lat, lng));
                };

                img.src = tileUrl;
            } catch (error) {
                console.error('Error in getHazardFromRaster:', error);
                resolve(getHazardEstimate(lat, lng));
            }
        });
    }

    function findClosestHazard(r, g, b) {
        let minDistance = Infinity;
        let closest = PGA_LOOKUP_TABLE[0];

        for (const hazard of PGA_LOOKUP_TABLE) {
            const [cr, cg, cb] = hazard.color;
            const distance = Math.sqrt(
                Math.pow(r - cr, 2) + Math.pow(g - cg, 2) + Math.pow(b - cb, 2)
            );

            if (distance < minDistance) {
                minDistance = distance;
                closest = hazard;
            }
        }

        return {
            pga: (closest.min + closest.max) / 2,
            level: closest.level,
            min: closest.min,
            max: closest.max
        };
    }

    function getHazardEstimate(lat, lng) {
        // Ring of Fire - high seismic activity
        if ((lat > 20 && lat < 50 && lng > 130 && lng < 150) ||
            (lat > -10 && lat < 20 && lng > 120 && lng < 140) ||
            (lat > 30 && lat < 60 && lng > -130 && lng < -110) ||
            (lat > -40 && lat < -20 && lng > -80 && lng < -60)) {
            return { pga: 0.65, level: "Extreme" };
        }
        // Mediterranean-Himalayan belt
        if ((lat > 35 && lat < 45 && lng > 10 && lng < 30) ||
            (lat > 25 && lat < 40 && lng > 70 && lng < 90)) {
            return { pga: 0.35, level: "Very High" };
        }
        // Moderate zones
        if ((lat > 30 && lat < 45 && lng > 70 && lng < 85) ||
            (lat > -20 && lat < -5 && lng > -75 && lng < -60)) {
            return { pga: 0.105, level: "High" };
        }
        // Low-moderate zones
        if ((lat > 30 && lat < 45 && lng > -125 && lng < -110) ||
            (lat > 35 && lat < 50 && lng > -10 && lng < 20)) {
            return { pga: 0.065, level: "Moderate-High" };
        }
        return { pga: 0.025, level: "Low-Moderate" };
    }

    // ==================== COUNTRY DATA LOADING ====================
    async function loadCountriesFromGeoJSON() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
            if (!response.ok) throw new Error('Failed to load GeoJSON');

            countryGeoJSON = await response.json();
            dynamicCountryData = {};

            countryGeoJSON.features.forEach(feature => {
                const countryName = feature.properties?.ADMIN || feature.properties?.name;
                if (!countryName) return;

                let sumLat = 0, sumLng = 0, count = 0;
                const coords = feature.geometry.coordinates;

                const processPolygon = (polygon) => {
                    if (polygon && polygon[0]) {
                        polygon[0].forEach(coord => {
                            sumLat += coord[1];
                            sumLng += coord[0];
                            count++;
                        });
                    }
                };

                if (feature.geometry.type === 'Polygon') {
                    processPolygon(coords);
                } else if (feature.geometry.type === 'MultiPolygon') {
                    coords.forEach(polygon => processPolygon(polygon));
                }

                if (count > 0) {
                    dynamicCountryData[countryName] = {
                        lat: sumLat / count,
                        lng: sumLng / count,
                        name: countryName,
                        geometry: feature.geometry
                    };
                }
            });

            console.log(`Loaded ${Object.keys(dynamicCountryData).length} countries`);
            return true;
        } catch (error) {
            console.error('Error loading countries:', error);
            loadFallbackCountries();
            return false;
        }
    }

    function loadFallbackCountries() {
        dynamicCountryData = {
            "United States": { lat: 39.8283, lng: -98.5795, name: "United States" },
            "China": { lat: 35.8617, lng: 104.1954, name: "China" },
            "Japan": { lat: 36.2048, lng: 138.2529, name: "Japan" },
            "India": { lat: 20.5937, lng: 78.9629, name: "India" },
            "Indonesia": { lat: -0.7893, lng: 113.9213, name: "Indonesia" },
            "Italy": { lat: 41.8719, lng: 12.5674, name: "Italy" },
            "Turkey": { lat: 38.9637, lng: 35.2433, name: "Turkey" },
            "Iran": { lat: 32.4279, lng: 53.6880, name: "Iran" },
            "Pakistan": { lat: 30.3753, lng: 69.3451, name: "Pakistan" },
            "Nepal": { lat: 28.3949, lng: 84.1240, name: "Nepal" },
            "Philippines": { lat: 12.8797, lng: 121.7740, name: "Philippines" },
            "Mexico": { lat: 23.6345, lng: -102.5528, name: "Mexico" },
            "Peru": { lat: -9.1900, lng: -75.0152, name: "Peru" },
            "Chile": { lat: -35.6751, lng: -71.5430, name: "Chile" },
            "New Zealand": { lat: -40.9006, lng: 174.8860, name: "New Zealand" }
        };
        console.log(`Loaded ${Object.keys(dynamicCountryData).length} fallback countries`);
    }

    function populateCountryDropdown() {
        const countrySelect = document.getElementById('countrySelect');
        if (!countrySelect) return;

        while (countrySelect.options.length > 1) {
            countrySelect.remove(1);
        }

        Object.keys(dynamicCountryData).sort().forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            countrySelect.appendChild(option);
        });
    }

    // ==================== COUNTRY BOUNDARIES ====================
    function addCountryBoundaries() {
        if (countryBoundaryLayer) {
            map.removeLayer(countryBoundaryLayer);
        }

        if (!countryGeoJSON) {
            console.warn('No country GeoJSON available');
            return;
        }

        countryBoundaryLayer = L.geoJSON(countryGeoJSON, {
            style: {
                color: '#2c3e50',
                weight: 1.2,
                fill: false,
                opacity: 0.8
            },
            onEachFeature: function (feature, layer) {
                const countryName = feature.properties?.ADMIN || 'Unknown';
                layer.bindTooltip(countryName, { sticky: true, className: 'country-tooltip' });
                layer.on('click', function (e) {
                    L.DomEvent.stopPropagation(e);
                    const data = dynamicCountryData[countryName];
                    if (data) {
                        selectLocation(countryName, data.lat, data.lng, countryName);
                    } else {
                        const coords = e.latlng;
                        selectLocation(countryName, coords.lat, coords.lng, countryName);
                    }
                });
            }
        }).addTo(map);

        if (isHazardVisible && hazardLayer) {
            hazardLayer.bringToFront();
        }
    }

    function removeCountryBoundaries() {
        if (countryBoundaryLayer) {
            map.removeLayer(countryBoundaryLayer);
            countryBoundaryLayer = null;
        }
    }

    // ==================== FAULT LINES ====================
    async function loadFaultLines() {
        if (faultLayer || faultLoading) return;
        faultLoading = true;
        updateStatus('Loading fault lines...', false);

        try {
            const response = await fetch('https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json');
            if (!response.ok) throw new Error('Failed to load fault data');

            const data = await response.json();

            faultLayer = L.geoJSON(data, {
                style: {
                    color: '#ff3b2f',
                    weight: 2,
                    opacity: 0.85
                },
                className: 'fault-line',
                onEachFeature: function (feature, layer) {
                    const name = feature.properties?.Name || feature.properties?.PlateName || "Plate Boundary";
                    layer.bindTooltip(name, { className: 'fault-tooltip', sticky: true });
                }
            });

            console.log('Fault lines loaded');
            if (isFaultVisible && map.getZoom() >= CONFIG.faultZoomThreshold) {
                faultLayer.addTo(map);
            }
            updateStatus('Ready', true);
        } catch (error) {
            console.error('Error loading fault lines:', error);
            updateStatus('Fault lines unavailable', true);
        } finally {
            faultLoading = false;
        }
    }

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
                updateStatus('Zoom in to see fault lines', false);
                setTimeout(() => {
                    if (!isFaultVisible) return;
                    updateStatus('Ready', true);
                }, 2000);
            }
        } else {
            if (faultLayer && map.hasLayer(faultLayer)) {
                map.removeLayer(faultLayer);
            }
        }
    }

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

    function handleLegendVisibility() {
        const legend = document.getElementById('legendSection');
        if (!legend) return;

        const currentZoom = map.getZoom();
        const shouldShow = !(currentZoom >= CONFIG.faultZoomThreshold && isFaultVisible);
        legend.style.display = shouldShow ? 'block' : 'none';
    }

    // ==================== SEARCH & LOCATION ====================
    async function searchNominatim(query) {
        if (!query || query.length < 2) return [];

        if (currentNominatimRequest) {
            currentNominatimRequest.abort();
        }

        const controller = new AbortController();
        currentNominatimRequest = controller;

        try {
            const params = new URLSearchParams({
                q: query,
                format: 'json',
                limit: 8,
                addressdetails: 1,
                'accept-language': 'en'
            });

            const response = await fetch(`${CONFIG.nominatimEndpoint}?${params.toString()}`, {
                signal: controller.signal,
                headers: { 'User-Agent': CONFIG.userAgent }
            });

            if (!response.ok) throw new Error('Nominatim request failed');

            const data = await response.json();
            currentNominatimRequest = null;

            return data.map(item => ({
                type: 'nominatim',
                name: item.display_name.split(',')[0],
                fullName: item.display_name,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                category: item.category || item.type
            }));
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Nominatim error:', error);
            }
            return [];
        }
    }

    async function selectLocation(name, lat, lng, country = '', fullAddress = '') {
        if (currentMarker) {
            map.removeLayer(currentMarker);
        }

        currentMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'custom-marker',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            })
        }).addTo(map);

        const hazard = await getHazardFromRaster(lat, lng);
        const displayName = fullAddress || name;

        const popupContent = `
            <strong>${escapeHtml(displayName)}</strong>${country ? `<br>${escapeHtml(country)}` : ''}<br>
            ${formatCoordinates(lat, lng)}<br>
            <span style="color: #d43f1a; font-weight: bold;">PGA: ${hazard.pga.toFixed(3)} g</span><br>
            <span>Hazard Level: ${hazard.level}</span>
        `;
        currentMarker.bindPopup(popupContent).openPopup();

        map.flyTo([lat, lng], CONFIG.flyToZoom, { duration: CONFIG.flyToDuration });
        setTimeout(() => {
            handleZoomForFaults();
        }, 300);

        const statsCard = document.getElementById('statsCard');
        const statPGA = document.getElementById('statPGA');
        const statLevel = document.getElementById('statLevel');
        const statCoords = document.getElementById('statCoords');
        const riskPGA = document.getElementById('riskPGA');

        if (statPGA) statPGA.textContent = hazard.pga.toFixed(3);
        if (riskPGA) riskPGA.textContent = hazard.pga.toFixed(3);
        if (statLevel) statLevel.textContent = hazard.level;
        if (statCoords) statCoords.textContent = formatCoordinates(lat, lng);
        if (statsCard) statsCard.style.display = 'block';
    }

    // ==================== MAP INITIALIZATION ====================
    function addCustomZoomControl() {
        const zoomControl = L.control({ position: 'topleft' });
        zoomControl.onAdd = function () {
            const div = L.DomUtil.create('div', 'custom-zoom-control');
            div.innerHTML = `
                <button class="zoom-in" aria-label="Zoom in">+</button>
                <button class="zoom-out" aria-label="Zoom out">−</button>
            `;
            L.DomEvent.disableClickPropagation(div);
            div.querySelector('.zoom-in').addEventListener('click', () => map.zoomIn());
            div.querySelector('.zoom-out').addEventListener('click', () => map.zoomOut());
            return div;
        };
        zoomControl.addTo(map);
    }

    function createHazardLayer() {
        if (hazardLayer) {
            map.removeLayer(hazardLayer);
        }

        hazardLayer = L.tileLayer(CONFIG.tilePath, {
            maxZoom: CONFIG.maxZoom,
            minZoom: CONFIG.minZoom,
            opacity: currentHazardOpacity,
            attribution: 'Seismic Hazard: GEM Foundation',
            crossOrigin: "Anonymous",
            errorTileUrl: '',
            bounds: [[-60, -180], [84, 180]]
        });

        hazardLayer.on('load', () => {
            updateStatus('Ready', true);
            tileErrorCount = 0;
        });

        hazardLayer.on('tileerror', (error) => {
            console.warn('Tile error:', error);
            tileErrorCount++;
            if (tileErrorCount === 1) {
                updateStatus('Loading tiles...', false);
            }
        });

        if (isHazardVisible) {
            hazardLayer.addTo(map);
        }
    }

    function changeBasemap(type) {
        if (currentBasemap) {
            map.removeLayer(currentBasemap);
        }

        let url, attribution;
        switch (type) {
            case 'dark':
                url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
                attribution = '&copy; OpenStreetMap &copy; CartoDB';
                break;
            case 'satellite':
                url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
                attribution = 'Tiles &copy; Esri';
                break;
            default:
                url = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
                attribution = '&copy; OpenStreetMap &copy; CartoDB';
        }

        currentBasemap = L.tileLayer(url, { attribution, subdomains: 'abcd' }).addTo(map);

        if (isHazardVisible && hazardLayer) {
            hazardLayer.bringToFront();
        }
        if (countryBoundaryLayer) {
            countryBoundaryLayer.bringToBack();
        }
    }

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

    function updateHazardOpacity(value) {
        currentHazardOpacity = value;
        if (hazardLayer) {
            hazardLayer.setOpacity(value);
        }
    }

    function buildLegend() {
        const legendList = document.getElementById('legendList');
        if (!legendList) return;

        PGA_LOOKUP_TABLE.forEach(item => {
            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            legendItem.innerHTML = `
                <span class="color-box" style="background: rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]});"></span>
                <span class="legend-range">${item.min.toFixed(2)} - ${item.max.toFixed(2)} g</span>
                <span class="legend-level">${item.level}</span>
            `;
            legendList.appendChild(legendItem);
        });
    }

    function setupSearch() {
        const searchInput = document.getElementById('searchInput');
        const searchResults = document.getElementById('searchResults');
        const clearSearchBtn = document.getElementById('clearSearchBtn');

        if (!searchInput || !searchResults) return;

        let searchDebounceTimer;

        async function performSearch(query) {
            if (!query || query.length < 2) return [];

            const results = [];
            const trimmedQuery = query.trim();

            const coordMatch = trimmedQuery.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
            if (coordMatch) {
                const lat = parseFloat(coordMatch[1]);
                const lng = parseFloat(coordMatch[2]);
                if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                    results.push({
                        type: 'coordinate',
                        name: `Coordinates: ${formatCoordinates(lat, lng)}`,
                        lat, lng,
                        fullName: `${lat}, ${lng}`
                    });
                }
            }

            const lowerQuery = trimmedQuery.toLowerCase();
            for (const [country, data] of Object.entries(dynamicCountryData)) {
                if (country.toLowerCase().includes(lowerQuery) && results.length < 5) {
                    results.push({
                        type: 'country',
                        name: country,
                        lat: data.lat,
                        lng: data.lng,
                        fullName: country
                    });
                }
            }

            const nominatimResults = await searchNominatim(trimmedQuery);
            for (const item of nominatimResults) {
                if (!results.some(r => Math.abs(r.lat - item.lat) < 0.01)) {
                    results.push(item);
                }
            }

            return results.slice(0, 10);
        }

        function displayResults(results) {
            if (!results.length) {
                searchResults.innerHTML = '<div class="no-results">No locations found. Try a city, country, or coordinates.</div>';
                searchResults.classList.add('show');
                return;
            }

            searchResults.innerHTML = results.map((r, i) => {
                let icon = r.type === 'country' ? '🌍' : (r.type === 'coordinate' ? '📍' : '🏙️');
                return `
                    <div class="result-item" data-index="${i}">
                        <div class="result-icon">${icon}</div>
                        <div class="result-content">
                            <div class="result-name">${escapeHtml(r.name)}</div>
                            <div class="result-coords">${r.lat.toFixed(4)}°, ${r.lng.toFixed(4)}°</div>
                        </div>
                    </div>
                `;
            }).join('');
            searchResults.classList.add('show');

            document.querySelectorAll('.result-item').forEach(el => {
                el.addEventListener('click', async () => {
                    const idx = parseInt(el.dataset.index);
                    const r = results[idx];
                    if (r) {
                        await selectLocation(r.name, r.lat, r.lng, '', r.fullName || r.name);
                        searchInput.value = r.fullName || r.name;
                        searchResults.classList.remove('show');
                        if (clearSearchBtn) clearSearchBtn.style.display = 'flex';
                    }
                });
            });
        }

        searchInput.addEventListener('input', function () {
            clearTimeout(searchDebounceTimer);
            const query = this.value.trim();
            if (clearSearchBtn) clearSearchBtn.style.display = query ? 'flex' : 'none';

            if (query.length < 2) {
                searchResults.classList.remove('show');
                return;
            }

            searchDebounceTimer = setTimeout(async () => {
                const results = await performSearch(query);
                displayResults(results);
            }, 400);
        });

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearSearchBtn.style.display = 'none';
                searchResults.classList.remove('show');
                searchInput.focus();
            });
        }

        searchInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query.length >= 2) {
                    const results = await performSearch(query);
                    if (results.length > 0) {
                        const first = results[0];
                        await selectLocation(first.name, first.lat, first.lng, '', first.fullName || first.name);
                        searchInput.value = first.fullName || first.name;
                        searchResults.classList.remove('show');
                    }
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.classList.remove('show');
            }
        });
    }

    function setupEventListeners() {
        const resetBtn = document.getElementById('resetViewBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                map.flyTo(CONFIG.defaultCenter, CONFIG.defaultZoom, { duration: CONFIG.flyToDuration });

                setTimeout(() => {
                    handleZoomForFaults();
                }, 300);

                if (currentMarker) {
                    map.removeLayer(currentMarker);
                    currentMarker = null;
                }

                const searchInput = document.getElementById('searchInput');
                const clearSearchBtn = document.getElementById('clearSearchBtn');
                if (searchInput) searchInput.value = '';
                if (clearSearchBtn) clearSearchBtn.style.display = 'none';

                const countrySelect = document.getElementById('countrySelect');
                if (countrySelect) countrySelect.value = '';

                const statsCard = document.getElementById('statsCard');
                if (statsCard) statsCard.style.display = 'none';

                const riskResult = document.getElementById('riskResult');
                if (riskResult) riskResult.innerHTML = '';

                const riskPGA = document.getElementById('riskPGA');
                if (riskPGA) riskPGA.textContent = '--';

                const heightInput = document.getElementById('buildingHeight');
                if (heightInput) heightInput.value = '';

                const soilSelect = document.getElementById('soilType');
                if (soilSelect) soilSelect.value = 'rock';

                const importanceSelect = document.getElementById('importanceLevel');
                if (importanceSelect) importanceSelect.value = 'normal';
            });
        }

        const locationBtn = document.getElementById('currentLocationBtn');
        if (locationBtn) {
            locationBtn.addEventListener('click', function () {
                if (navigator.geolocation) {
                    const originalHTML = this.innerHTML;
                    this.innerHTML = '<div style="width:20px;height:20px;border:2px solid white;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>';
                    this.disabled = true;

                    navigator.geolocation.getCurrentPosition(
                        async (pos) => {
                            await selectLocation('Your Location', pos.coords.latitude, pos.coords.longitude, '');
                            this.innerHTML = originalHTML;
                            this.disabled = false;
                        },
                        () => {
                            alert('Unable to get your location. Please check permissions.');
                            this.innerHTML = originalHTML;
                            this.disabled = false;
                        }
                    );
                } else {
                    alert('Geolocation is not supported by your browser');
                }
            });
        }

        const countrySelect = document.getElementById('countrySelect');
        if (countrySelect) {
            countrySelect.addEventListener('change', async function () {
                const country = this.value;
                if (country && dynamicCountryData[country]) {
                    const data = dynamicCountryData[country];
                    await selectLocation(country, data.lat, data.lng, country);
                }
            });
        }

        const panelToggle = document.getElementById('layerPanelToggle');
        const layerPanel = document.getElementById('layerPanel');
        if (panelToggle && layerPanel) {
            panelToggle.addEventListener('click', () => {
                layerPanel.classList.toggle('collapsed');
                panelToggle.textContent = layerPanel.classList.contains('collapsed') ? '+' : '−';
            });
        }

        document.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) changeBasemap(e.target.value);
            });
        });

        const hazardToggle = document.getElementById('hazardLayerToggle');
        const opacityControl = document.getElementById('opacityControl');
        if (hazardToggle) {
            hazardToggle.addEventListener('change', (e) => {
                toggleHazardLayer(e.target.checked);
                if (opacityControl) opacityControl.style.display = e.target.checked ? 'flex' : 'none';
            });
        }

        const boundaryToggle = document.getElementById('countryBoundaryToggle');
        if (boundaryToggle) {
            boundaryToggle.addEventListener('change', (e) => {
                if (e.target.checked) addCountryBoundaries();
                else removeCountryBoundaries();
            });
        }

        const faultToggle = document.getElementById('faultLinesToggle');
        if (faultToggle) {
            faultToggle.addEventListener('change', (e) => {
                toggleFaultLines(e.target.checked);
            });
        }

        const opacitySlider = document.getElementById('opacitySlider');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                updateHazardOpacity(e.target.value / 100);
            });
        }

        map.on('zoomend', handleZoomForFaults);
        map.on('zoomend', handleLegendVisibility);
        map.on('click', async (e) => {
            const { lat, lng } = e.latlng;
            await selectLocation('Selected Location', lat, lng, '');
        });

        map.on('mousemove', (e) => {
            const coordsDisplay = document.getElementById('coordsDisplay');
            if (coordsDisplay) {
                coordsDisplay.innerHTML = `<span>Lat: ${e.latlng.lat.toFixed(4)}°</span><span>Lng: ${e.latlng.lng.toFixed(4)}°</span>`;
            }
        });
    }

    function initMap() {
        map = L.map('map', {
            center: CONFIG.defaultCenter,
            zoom: CONFIG.defaultZoom,
            minZoom: CONFIG.minZoom,
            maxZoom: CONFIG.maxZoom,
            maxBounds: CONFIG.maxBounds,
            maxBoundsViscosity: 1.0,
            zoomControl: false
        });

        addCustomZoomControl();
        currentBasemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CartoDB',
            subdomains: 'abcd'
        }).addTo(map);

        createHazardLayer();
        L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(map);
        updateStatus('Ready', true);
    }

    function setupRiskAnalysis() {
        const analyzeBtn = document.getElementById('analyzeBtn');
        if (!analyzeBtn) return;

        analyzeBtn.addEventListener('click', () => {
            const pgaElement = document.getElementById('statPGA');
            const pga = parseFloat(pgaElement ? pgaElement.textContent : 'NaN');

            if (isNaN(pga)) {
                alert("Please click on the map first to select a location.");
                return;
            }

            const soil = document.getElementById('soilType').value;
            const height = parseInt(document.getElementById('buildingHeight').value) || 1;
            const importance = document.getElementById('importanceLevel').value;

            let score = 0;

            // PGA factor
            if (pga < 0.05) score += 1;
            else if (pga < 0.15) score += 2;
            else if (pga < 0.35) score += 3;
            else score += 4;

            // Soil factor
            if (soil === "medium") score += 1;
            if (soil === "soft") score += 2;

            // Height factor
            if (height > 3) score += 1;
            if (height > 7) score += 2;
            if (height > 12) score += 3;

            // Importance factor
            if (importance === "important") score += 1;
            if (importance === "critical") score += 2;

            let risk = "", color = "", advice = "";

            if (score <= 3) {
                risk = "Low";
                color = "green";
                advice = "Safe for standard construction.";
            } else if (score <= 6) {
                risk = "Moderate";
                color = "orange";
                advice = "Use earthquake-resistant design.";
            } else if (score <= 9) {
                risk = "High";
                color = "darkorange";
                advice = "Strong structural reinforcement required.";
            } else {
                risk = "Very High";
                color = "red";
                advice = "Advanced engineering required. Avoid conventional design.";
            }

            if (importance === "critical") {
                advice += "<br><br><strong>Critical Infrastructure:</strong><br>";
                advice += "• Use base isolation<br>";
                advice += "• Follow IS 1893 & IS 13920<br>";
                advice += "• Ensure post-earthquake operation";
            }

            const riskResult = document.getElementById('riskResult');
            if (riskResult) {
                riskResult.innerHTML = `
                    <div style="padding:10px; border-radius:8px; border-left:5px solid ${color}; background:#f9f9f9;">
                        <strong style="color:${color};">Risk Level: ${risk}</strong><br>
                        Score: ${score}<br><br>
                        ${advice}
                    </div>
                `;
            }
        });
    }

    function setupRiskPanelToggle() {
        const riskPanel = document.getElementById('riskPanelFloating');
        const toggleBtn = document.getElementById('toggleRiskPanel');

        if (riskPanel && toggleBtn) {
            riskPanel.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                riskPanel.classList.toggle('collapsed');
                toggleBtn.textContent = riskPanel.classList.contains('collapsed') ? '+' : '−';
            });
        }
    }

    async function init() {
        console.log('Initializing Seismic Hazard Map with local tiles...');
        console.log('Tile path:', CONFIG.tilePath);
        console.log('Place your hazard tiles in the "tiles" folder with structure: tiles/{z}/{x}/{y}.png');

        initMap();
        buildLegend();
        await loadCountriesFromGeoJSON();
        populateCountryDropdown();
        setupEventListeners();
        setupSearch();
        setupRiskAnalysis();
        setupRiskPanelToggle();
        handleZoomForFaults();
        handleLegendVisibility();
        updateStatus('Ready', true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();