/**
 * Global Seismic Hazard Map - Professional Version
 * GEM Foundation v2023.1
 * Handles map visualization, location search, and seismic hazard data display
 */

(function() {
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
        flyToZoom: 5,
        flyToDuration: 1.2
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

    // Country Data with capitals
    const COUNTRY_DATA = {
        "Japan": { lat: 35.6762, lng: 139.6503, capital: "Tokyo" },
        "United States": { lat: 38.9072, lng: -77.0369, capital: "Washington D.C." },
        "Mexico": { lat: 19.4326, lng: -99.1332, capital: "Mexico City" },
        "Indonesia": { lat: -6.2088, lng: 106.8456, capital: "Jakarta" },
        "Philippines": { lat: 14.5995, lng: 120.9842, capital: "Manila" },
        "Turkey": { lat: 39.9334, lng: 32.8597, capital: "Ankara" },
        "Nepal": { lat: 27.7172, lng: 85.3240, capital: "Kathmandu" },
        "India": { lat: 28.6139, lng: 77.2090, capital: "New Delhi" },
        "Italy": { lat: 41.9028, lng: 12.4964, capital: "Rome" },
        "Greece": { lat: 37.9838, lng: 23.7275, capital: "Athens" },
        "China": { lat: 39.9042, lng: 116.4074, capital: "Beijing" },
        "Iran": { lat: 35.6892, lng: 51.3890, capital: "Tehran" },
        "Chile": { lat: -33.4489, lng: -70.6693, capital: "Santiago" },
        "Peru": { lat: -12.0464, lng: -77.0428, capital: "Lima" },
        "New Zealand": { lat: -41.2865, lng: 174.7762, capital: "Wellington" },
        "Costa Rica": { lat: 9.9281, lng: -84.0907, capital: "San José" },
        "Pakistan": { lat: 33.6844, lng: 73.0479, capital: "Islamabad" },
        "Colombia": { lat: 4.7110, lng: -74.0721, capital: "Bogotá" },
        "France": { lat: 48.8566, lng: 2.3522, capital: "Paris" },
        "Germany": { lat: 52.5200, lng: 13.4050, capital: "Berlin" },
        "Spain": { lat: 40.4168, lng: -3.7038, capital: "Madrid" },
        "Portugal": { lat: 38.7223, lng: -9.1393, capital: "Lisbon" },
        "Thailand": { lat: 13.7367, lng: 100.5231, capital: "Bangkok" },
        "Vietnam": { lat: 21.0285, lng: 105.8542, capital: "Hanoi" },
        "Myanmar": { lat: 16.8409, lng: 96.1735, capital: "Naypyidaw" },
        "Afghanistan": { lat: 34.5553, lng: 69.2075, capital: "Kabul" },
        "Egypt": { lat: 30.0444, lng: 31.2357, capital: "Cairo" },
        "South Africa": { lat: -25.7479, lng: 28.2293, capital: "Pretoria" },
        "Kenya": { lat: -1.2864, lng: 36.8172, capital: "Nairobi" },
        "Brazil": { lat: -15.7939, lng: -47.8828, capital: "Brasília" },
        "Argentina": { lat: -34.6037, lng: -58.3816, capital: "Buenos Aires" },
        "Canada": { lat: 45.4215, lng: -75.6972, capital: "Ottawa" },
        "Australia": { lat: -33.8688, lng: 151.2093, capital: "Sydney" }
    };

    // ==================== GLOBAL VARIABLES ====================
    let map;
    let currentMarker = null;
    let hazardLayer;
    let currentBasemap = null;
    let countryBoundaryLayer = null;
    let isHazardVisible = true;
    let currentHazardOpacity = CONFIG.hazardOpacity;

    // ==================== HELPER FUNCTIONS ====================
    
    function parseCoordinates(input) {
        let str = input.trim().replace(/[°′"''\s]+/g, ' ');
        let decimalMatch = str.match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
        if (decimalMatch) {
            let lat = parseFloat(decimalMatch[1]);
            let lng = parseFloat(decimalMatch[2]);
            if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                return { lat, lng };
            }
        }
        return null;
    }

    function formatCoordinates(lat, lng) {
        return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
    }

    async function getHazardFromRaster(lat, lng) {
        return new Promise((resolve) => {
            try {
                const zoom = map.getZoom();
                const point = map.project([lat, lng], zoom);
                const tileSize = 256;
                const tileX = Math.floor(point.x / tileSize);
                const tileY = Math.floor(point.y / tileSize);
                
                const tileUrl = CONFIG.tilePath
                    .replace('{z}', zoom)
                    .replace('{x}', tileX)
                    .replace('{y}', tileY);
                
                const img = new Image();
                img.crossOrigin = "Anonymous";
                
                img.onload = function() {
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
                };
                
                img.onerror = function() {
                    resolve(getHazardEstimate(lat, lng));
                };
                
                img.src = tileUrl;
                
                setTimeout(() => {
                    resolve(getHazardEstimate(lat, lng));
                }, 5000);
            } catch (error) {
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
                Math.pow(r - cr, 2) + 
                Math.pow(g - cg, 2) + 
                Math.pow(b - cb, 2)
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
        if ((lat > 20 && lat < 50 && lng > 130 && lng < 150) ||
            (lat > -10 && lat < 20 && lng > 120 && lng < 140) ||
            (lat > 30 && lat < 60 && lng > -130 && lng < -110) ||
            (lat > -40 && lat < -20 && lng > -80 && lng < -60)) {
            return { pga: 0.65, level: "Extreme" };
        }
        
        if ((lat > 35 && lat < 45 && lng > 10 && lng < 30) ||
            (lat > 25 && lat < 40 && lng > 70 && lng < 90)) {
            return { pga: 0.35, level: "Very High" };
        }
        
        if ((lat > 30 && lat < 45 && lng > 70 && lng < 85) ||
            (lat > -20 && lat < -5 && lng > -75 && lng < -60)) {
            return { pga: 0.105, level: "High" };
        }
        
        if ((lat > 30 && lat < 45 && lng > -125 && lng < -110) ||
            (lat > 35 && lat < 50 && lng > -10 && lng < 20)) {
            return { pga: 0.065, level: "Moderate-High" };
        }
        
        return { pga: 0.025, level: "Low-Moderate" };
    }
    
    async function updateStatsPanel(lat, lng) {
        const statsCard = document.getElementById('statsCard');
        const statPGA = document.getElementById('statPGA');
        const statLevel = document.getElementById('statLevel');
        const statCoords = document.getElementById('statCoords');
        
        statPGA.textContent = '--';
        statLevel.textContent = 'Loading...';
        statCoords.textContent = formatCoordinates(lat, lng);
        statsCard.style.display = 'block';
        
        try {
            const hazard = await getHazardFromRaster(lat, lng);
            statPGA.textContent = hazard.pga.toFixed(3);
            statLevel.textContent = hazard.level;
        } catch (error) {
            const fallback = getHazardEstimate(lat, lng);
            statPGA.textContent = fallback.pga.toFixed(3);
            statLevel.textContent = fallback.level + ' (est.)';
        }
    }
    
    async function selectLocation(name, lat, lng, country = '') {
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
        
        let hazard;
        try {
            hazard = await getHazardFromRaster(lat, lng);
        } catch (error) {
            hazard = getHazardEstimate(lat, lng);
        }
        
        const popupContent = `
            <strong>${escapeHtml(name)}</strong>${country ? `<br>${escapeHtml(country)}` : ''}<br>
            ${formatCoordinates(lat, lng)}<br>
            <span style="color: #d43f1a; font-weight: bold;">PGA: ${hazard.pga.toFixed(3)} g</span><br>
            <span>Hazard Level: ${hazard.level}</span>
        `;
        currentMarker.bindPopup(popupContent).openPopup();
        
        map.flyTo([lat, lng], CONFIG.flyToZoom, { duration: CONFIG.flyToDuration });
        await updateStatsPanel(lat, lng);
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    // ==================== MAP INITIALIZATION ====================
    
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
        
        // Default basemap
        currentBasemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CartoDB',
            subdomains: 'abcd'
        }).addTo(map);
        
        // Create hazard layer with proper configuration
        createHazardLayer();
        
        // Scale control
        L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(map);
        
        // Map events
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
        
        updateStatus('Ready', true);
    }
    
    function createHazardLayer() {
        // Remove existing layer if it exists
        if (hazardLayer) {
            map.removeLayer(hazardLayer);
        }
        
        // Create new hazard layer
        hazardLayer = L.tileLayer(CONFIG.tilePath, {
            maxZoom: CONFIG.maxZoom,
            minZoom: CONFIG.minZoom,
            opacity: currentHazardOpacity,
            attribution: 'Seismic Hazard: GEM Foundation',
            errorTileUrl: '',
            crossOrigin: "Anonymous",
            zIndex: 1000  // Set high z-index to ensure it stays on top
        });
        
        // Add to map if visible
        if (isHazardVisible) {
            hazardLayer.addTo(map);
        }
        
        // Tile loading events
        hazardLayer.on('load', () => updateStatus('Ready', true));
        hazardLayer.on('loading', () => updateStatus('Loading tiles...', false));
    }
    
    function addCustomZoomControl() {
        const zoomControl = L.control({ position: 'topleft' });
        
        zoomControl.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'custom-zoom-control');
            div.innerHTML = `
                <button class="zoom-in" aria-label="Zoom in">+</button>
                <button class="zoom-out" aria-label="Zoom out">−</button>
            `;
            
            L.DomEvent.disableClickPropagation(div);
            
            const zoomInBtn = div.querySelector('.zoom-in');
            const zoomOutBtn = div.querySelector('.zoom-out');
            
            zoomInBtn.addEventListener('click', () => map.zoomIn());
            zoomOutBtn.addEventListener('click', () => map.zoomOut());
            
            return div;
        };
        
        zoomControl.addTo(map);
    }
    
    // ==================== COUNTRY BOUNDARIES ====================
    
    function addCountryBoundaries() {
        if (countryBoundaryLayer) {
            map.removeLayer(countryBoundaryLayer);
        }
        
        // Using Natural Earth Data for country boundaries (reliable GeoJSON source)
        const geojsonUrl = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
        
        fetch(geojsonUrl)
            .then(response => response.json())
            .then(data => {
                countryBoundaryLayer = L.geoJSON(data, {
                    style: {
                        color: '#2c3e50',
                        weight: 1.2,
                        fill: false,
                        opacity: 0.8
                    },
                    onEachFeature: function(feature, layer) {
                        const countryName = feature.properties?.ADMIN || feature.properties?.name || 'Unknown';
                        layer.bindTooltip(countryName, { sticky: true, className: 'country-tooltip' });
                        layer.on('click', function(e) {
                            L.DomEvent.stopPropagation(e);
                            const coords = e.latlng;
                            selectLocation(countryName, coords.lat, coords.lng, countryName);
                        });
                    }
                }).addTo(map);
                
                // Ensure hazard layer stays on top after adding boundaries
                if (isHazardVisible && hazardLayer) {
                    hazardLayer.bringToFront();
                }
                
                console.log('Country boundaries loaded successfully');
            })
            .catch(error => {
                console.error('Error loading country boundaries:', error);
                addFallbackBoundaries();
            });
    }
    
    function addFallbackBoundaries() {
        const majorCountries = [
            { name: "Japan", coords: [[30, 128], [45, 128], [45, 146], [30, 146]] },
            { name: "United States", coords: [[25, -125], [49, -125], [49, -65], [25, -65]] },
            { name: "Mexico", coords: [[15, -118], [32, -118], [32, -86], [15, -86]] },
            { name: "Indonesia", coords: [[-10, 95], [6, 95], [6, 141], [-10, 141]] },
            { name: "India", coords: [[8, 68], [35, 68], [35, 97], [8, 97]] },
            { name: "China", coords: [[18, 73], [53, 73], [53, 135], [18, 135]] },
            { name: "Australia", coords: [[-44, 112], [-10, 112], [-10, 154], [-44, 154]] }
        ];
        
        const fallbackFeatures = majorCountries.map(country => ({
            type: "Feature",
            properties: { ADMIN: country.name },
            geometry: {
                type: "Polygon",
                coordinates: [country.coords.map(c => [c[1], c[0]])]
            }
        }));
        
        countryBoundaryLayer = L.geoJSON({
            type: "FeatureCollection",
            features: fallbackFeatures
        }, {
            style: { color: '#2c3e50', weight: 1.2, fill: false, opacity: 0.8 },
            onEachFeature: function(feature, layer) {
                layer.bindTooltip(feature.properties.ADMIN, { sticky: true });
                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    selectLocation(feature.properties.ADMIN, e.latlng.lat, e.latlng.lng, feature.properties.ADMIN);
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
    
    // ==================== BASEMAP FUNCTIONS ====================
    
    function changeBasemap(type) {
        if (currentBasemap) {
            map.removeLayer(currentBasemap);
        }
        
        let url;
        let attribution;
        
        switch(type) {
            case 'dark':
                url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
                attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CartoDB';
                break;
            case 'satellite':
                url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
                attribution = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
                break;
            default:
                url = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
                attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CartoDB';
        }
        
        currentBasemap = L.tileLayer(url, {
            attribution: attribution,
            subdomains: 'abcd'
        }).addTo(map);
        
        // IMPORTANT: Re-add hazard layer to ensure it stays on top after basemap change
        if (isHazardVisible && hazardLayer) {
            // Remove and re-add to bring to front
            map.removeLayer(hazardLayer);
            hazardLayer.addTo(map);
            // Apply current opacity
            hazardLayer.setOpacity(currentHazardOpacity);
        }
        
        // Also ensure country boundaries are behind hazard layer if present
        if (countryBoundaryLayer) {
            countryBoundaryLayer.bringToBack();
        }
    }
    
    function updateHazardOpacity(value) {
        currentHazardOpacity = value;
        if (hazardLayer) {
            hazardLayer.setOpacity(value);
        }
    }
    
    function toggleHazardLayer(visible) {
        isHazardVisible = visible;
        if (hazardLayer) {
            if (visible) {
                hazardLayer.addTo(map);
                hazardLayer.setOpacity(currentHazardOpacity);
            } else {
                map.removeLayer(hazardLayer);
            }
        }
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
    
    // ==================== BUILD LEGEND ====================
    
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
    
    function populateCountryDropdown() {
        const countrySelect = document.getElementById('countrySelect');
        if (!countrySelect) return;
        
        Object.keys(COUNTRY_DATA).sort().forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            countrySelect.appendChild(option);
        });
    }
    
    // ==================== EVENT HANDLERS ====================
    
    function setupEventListeners() {
        // Reset view
        const resetBtn = document.getElementById('resetViewBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                map.flyTo(CONFIG.defaultCenter, CONFIG.defaultZoom, { duration: CONFIG.flyToDuration });
                if (currentMarker) map.removeLayer(currentMarker);
                document.getElementById('searchInput').value = '';
                document.getElementById('clearSearchBtn').style.display = 'none';
                document.getElementById('countrySelect').value = '';
                document.getElementById('statsCard').style.display = 'none';
            });
        }
        
        // Current location (icon only)
        const locationBtn = document.getElementById('currentLocationBtn');
        if (locationBtn) {
            locationBtn.addEventListener('click', function() {
                if (navigator.geolocation) {
                    const originalHTML = this.innerHTML;
                    this.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
                    this.disabled = true;
                    
                    navigator.geolocation.getCurrentPosition(
                        async (pos) => {
                            await selectLocation('Your Location', pos.coords.latitude, pos.coords.longitude, '');
                            this.innerHTML = originalHTML;
                            this.disabled = false;
                        },
                        (err) => {
                            let message = 'Unable to get location';
                            if (err.code === 1) message = 'Location permission denied';
                            alert(message);
                            this.innerHTML = originalHTML;
                            this.disabled = false;
                        },
                        { timeout: 10000, enableHighAccuracy: true }
                    );
                } else {
                    alert('Geolocation not supported by your browser');
                }
            });
        }
        
        // Country select
        const countrySelect = document.getElementById('countrySelect');
        if (countrySelect) {
            countrySelect.addEventListener('change', async function() {
                const country = this.value;
                if (country && COUNTRY_DATA[country]) {
                    const data = COUNTRY_DATA[country];
                    await selectLocation(data.capital, data.lat, data.lng, country);
                }
            });
        }
        
        // Layer panel toggle
        const panelToggle = document.getElementById('layerPanelToggle');
        const layerPanel = document.getElementById('layerPanel');
        if (panelToggle && layerPanel) {
            panelToggle.addEventListener('click', () => {
                layerPanel.classList.toggle('collapsed');
                panelToggle.textContent = layerPanel.classList.contains('collapsed') ? '+' : '−';
            });
        }
        
        // Basemap radio buttons
        document.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    changeBasemap(e.target.value);
                }
            });
        });
        
        // Hazard layer toggle
        const hazardToggle = document.getElementById('hazardLayerToggle');
        const opacityControl = document.getElementById('opacityControl');
        if (hazardToggle) {
            hazardToggle.addEventListener('change', (e) => {
                toggleHazardLayer(e.target.checked);
                if (opacityControl) {
                    opacityControl.style.display = e.target.checked ? 'flex' : 'none';
                }
            });
        }
        
        // Country boundary toggle
        const boundaryToggle = document.getElementById('countryBoundaryToggle');
        if (boundaryToggle) {
            boundaryToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    addCountryBoundaries();
                } else {
                    removeCountryBoundaries();
                }
            });
        }
        
        // Opacity slider
        const opacitySlider = document.getElementById('opacitySlider');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                const opacity = e.target.value / 100;
                updateHazardOpacity(opacity);
            });
        }
    }
    
    // ==================== SEARCH FUNCTIONALITY ====================
    
    function setupSearch() {
        const searchInput = document.getElementById('searchInput');
        const searchResults = document.getElementById('searchResults');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        
        if (!searchInput || !searchResults) return;
        
        function searchLocations(query) {
            if (!query || query.length < 2) return [];
            
            const trimmedQuery = query.trim();
            const results = [];
            
            const coords = parseCoordinates(trimmedQuery);
            if (coords) {
                results.push({
                    type: 'coordinates',
                    name: `Coordinates: ${formatCoordinates(coords.lat, coords.lng)}`,
                    country: '',
                    lat: coords.lat,
                    lng: coords.lng,
                    isCoordinate: true
                });
            }
            
            const lowerQuery = trimmedQuery.toLowerCase();
            for (const [country, data] of Object.entries(COUNTRY_DATA)) {
                if (country.toLowerCase().includes(lowerQuery) || 
                    data.capital.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        type: 'country',
                        name: data.capital,
                        country: country,
                        lat: data.lat,
                        lng: data.lng,
                        isCoordinate: false
                    });
                }
            }
            
            return results.slice(0, 8);
        }
        
        let debounceTimer;
        
        searchInput.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            const query = this.value.trim();
            clearSearchBtn.style.display = query ? 'flex' : 'none';
            
            debounceTimer = setTimeout(() => {
                if (query.length >= 2) {
                    const results = searchLocations(query);
                    
                    if (results.length) {
                        searchResults.innerHTML = results.map((r, i) => `
                            <div class="result-item" data-index="${i}">
                                <div class="result-icon">${r.isCoordinate ? '📍' : '🏙️'}</div>
                                <div class="result-content">
                                    <div class="result-name">${escapeHtml(r.name)}${r.country ? `, ${escapeHtml(r.country)}` : ''}</div>
                                    <div class="result-coords">${r.lat.toFixed(4)}°, ${r.lng.toFixed(4)}°</div>
                                </div>
                            </div>
                        `).join('');
                        searchResults.classList.add('show');
                        
                        document.querySelectorAll('.result-item').forEach(el => {
                            el.addEventListener('click', async () => {
                                const idx = parseInt(el.dataset.index);
                                const r = results[idx];
                                if (r.isCoordinate) {
                                    await selectLocation(r.name, r.lat, r.lng, '');
                                    searchInput.value = `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
                                } else {
                                    await selectLocation(r.name, r.lat, r.lng, r.country);
                                    searchInput.value = `${r.name}, ${r.country}`;
                                }
                                searchResults.classList.remove('show');
                            });
                        });
                    } else {
                        searchResults.innerHTML = '<div class="no-results">No locations found. Try coordinates like "40.7128, -74.0060"</div>';
                        searchResults.classList.add('show');
                    }
                } else {
                    searchResults.classList.remove('show');
                }
            }, 300);
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
                    const results = searchLocations(query);
                    if (results.length > 0) {
                        const firstResult = results[0];
                        if (firstResult.isCoordinate) {
                            await selectLocation(firstResult.name, firstResult.lat, firstResult.lng, '');
                            searchInput.value = `${firstResult.lat.toFixed(6)}, ${firstResult.lng.toFixed(6)}`;
                        } else {
                            await selectLocation(firstResult.name, firstResult.lat, firstResult.lng, firstResult.country);
                            searchInput.value = `${firstResult.name}, ${firstResult.country}`;
                        }
                        searchResults.classList.remove('show');
                    } else if (parseCoordinates(query)) {
                        const coords = parseCoordinates(query);
                        if (coords) {
                            await selectLocation(`Coordinates: ${formatCoordinates(coords.lat, coords.lng)}`, coords.lat, coords.lng, '');
                            searchInput.value = `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;
                            searchResults.classList.remove('show');
                        }
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
    
    // ==================== INITIALIZATION ====================
    
    function init() {
        console.log('Initializing Global Seismic Hazard Map...');
        
        try {
            initMap();
            buildLegend();
            populateCountryDropdown();
            setupEventListeners();
            setupSearch();
            
            console.log('Map initialized successfully');
        } catch (error) {
            console.error('Error initializing map:', error);
            updateStatus('Error loading map', false);
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();