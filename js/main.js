console.log("main.js script started execution."); // DEBUG LOG

// Global variable to store processed data
let allPublicationData = [];
let uniqueYears = new Set();
let uniqueDomains = new Set(); // Uncommented to store unique domains

// Global variables for current filter selections
let currentSelectedYear = null;
let currentSelectedDomain = ""; // Uncommented to use domain filtering

// Global variables for year range
let globalMinYear = null;
let globalMaxYear = null;

// Global variable for filtered data, used by popup/marker logic
let filteredDataGlobal = []; // Stores currently filtered data

// Animation state variables
let isAnimating = false;
let animationIntervalId = null;
const animationSpeed = 1000; // Milliseconds between year changes (e.g., 2 seconds)

// Initialize the map
// Coordinates for center view (e.g., center of the Pacific) and zoom level
const initialCoords = [20, 0]; // RESTORING
const initialZoom = 2; // RESTORING

// Create the map instance and set the initial view
// 'map' is the id of the div in index.html
// /* // Temporarily commented out for memory debugging // This was the start of the big block
const map = L.map('map', { // RESTORING
    zoomControl: true, // Default is true, explicitly setting for clarity
}).setView(initialCoords, initialZoom); // RESTORING

// Add a tile layer (base map) - OpenStreetMap is a common choice
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { // RESTORING
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map); // RESTORING

// Add Scale Control
L.control.scale({ // RESTORING
    metric: true, // Use metric units (kilometers)
    imperial: false // Do not use imperial units (miles)
}).addTo(map); // RESTORING

console.log("Leaflet map initialized with zoom and scale controls."); // RESTORING

// --- Heatmap Configuration Function ---
function getHeatmapOptions(currentZoom) {
    // Base radius and blur for a reference zoom level (e.g., initialZoom)
    const baseRadius = 20; // Increased base
    const baseBlur = 15;   // Increased base
    const referenceZoom = initialZoom; 

    // Adjusted scaling factor for more pronounced growth
    // The exponent deltaZoom directly controls how fast radius grows with zoom.
    // Power of 1.5 means it grows faster than linear but not as fast as power of 2.
    const deltaZoom = currentZoom - referenceZoom;
    let scaleFactor;
    if (deltaZoom >= 0) {
        // Scale up more aggressively: radius grows roughly with 2^(deltaZoom * 0.75)
        // Example: zoom +1 -> 2^0.75 = 1.68x, zoom +2 -> 2^1.5 = 2.82x, zoom +3 -> 2^2.25 = 4.75x
        scaleFactor = Math.pow(2, deltaZoom * 0.75); 
    } else {
        // Scale down, perhaps less aggressively or keep it as before
        scaleFactor = Math.pow(2, deltaZoom * 0.5); // Softer reduction for zoom out
    }
    
    let dynamicRadius = baseRadius * scaleFactor;
    let dynamicBlur = baseBlur * scaleFactor;

    const maxRadius = 80; // Increased max
    const maxBlur = 60;   // Increased max
    dynamicRadius = Math.min(dynamicRadius, maxRadius);
    dynamicBlur = Math.min(dynamicBlur, maxBlur);
    
    dynamicRadius = Math.max(dynamicRadius, 8); // Increased min radius
    dynamicBlur = Math.max(dynamicBlur, 5);   // Increased min blur

    // Dynamically adjust max intensity for the heatmap
    // As radius increases, we might want to increase `max` to prevent oversaturation
    // Start with a baseMax and increase it slightly with zoom.
    let dynamicMax = 0.4 + (Math.min(deltaZoom, 5)) * 0.05; // Base 0.4, increases by 0.05 per zoom level over reference, capped increase.
    dynamicMax = Math.max(0.3, Math.min(dynamicMax, 0.8)); // Ensure it stays within a reasonable range (e.g., 0.3 to 0.8)

    // console.log(`Zoom: ${currentZoom}, Radius: ${dynamicRadius}, Blur: ${dynamicBlur}, MaxIntensity: ${dynamicMax}`);

    return {
        radius: dynamicRadius,
        blur: dynamicBlur,
        maxZoom: 19, 
        gradient: { 
            0.33: 'blue',
            0.66: 'lime',
            1.0: 'red'
        },
        max: dynamicMax, // Use dynamic max
        minOpacity: 0.3 // Slightly reduced minOpacity to see more of the lower values if needed
    };
}

// --- Initialize Heatmap Layer ---
// Initialize with options based on current map zoom
const heatLayer = L.heatLayer([], getHeatmapOptions(map.getZoom())).addTo(map);
console.log("Leaflet.heat layer initialized with dynamic options based on initial zoom.");

// Add a listener for zoomend to update heatmap options
map.on('zoomend', function() {
    console.log("Zoom ended. Current zoom level: " + map.getZoom());
    const newOptions = getHeatmapOptions(map.getZoom());
    heatLayer.setOptions(newOptions);
    // Data doesn't need to be re-added unless it changes, setOptions should redraw.
    // If heatmapData is available globally and needs to be re-set (e.g. if transformDataForHeatmap changes with zoom):
    // const currentHeatmapData = transformDataForHeatmap(filteredDataGlobal); // Assuming filteredDataGlobal is up-to-date
    // heatLayer.setLatLngs(currentHeatmapData);
    console.log("Heatmap options updated for new zoom level.");
});

// Layer group for hotspot markers (Opción 3 para popups)
let hotspotMarkersLayer = L.layerGroup().addTo(map);
let clusterAreaLayer = L.layerGroup().addTo(map); // New layer for cluster polygons

// Add the legend to the map globally after map and heatLayer are initialized
addHeatmapLegend(map, getHeatmapOptions(map.getZoom()));
// */ // This was the end of the Leaflet init block, other functions remain commented below -> this should be the end of heatlayer block comment

// --- Add Heatmap Legend ---
function addHeatmapLegend(mapInstance, heatmapOptions) {
    const legend = L.control({ position: 'bottomleft' });

    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        const gradientConfig = heatmapOptions.gradient || { 0.4: 'blue', 0.65: 'lime', 1: 'red' };
        // const maxIntensity = heatmapOptions.max || 1.0; // Not directly used for gradient display here

        let legendHtml = '<strong>Publication Density</strong>';
        legendHtml += '<div class="legend-body">';

        // Create the gradient bar itself
        // Sort stops by percentage to build the gradient string correctly
        const sortedGradientStops = Object.entries(gradientConfig)
            .map(([stop, color]) => ({ stop: parseFloat(stop), color }))
            .sort((a, b) => a.stop - b.stop);

        let gradientCssString = 'linear-gradient(to top, ';
        if (sortedGradientStops.length > 0 && sortedGradientStops[0].stop > 0) {
            // If the first stop is not 0, add it with the first color to start the gradient from the bottom
            gradientCssString += `${sortedGradientStops[0].color} 0%, `;
        }
        gradientCssString += sortedGradientStops
            .map(item => `${item.color} ${item.stop * 100}%`)
            .join(', ');
        // If the last stop is not 1 (100%), add it with the last color to fill to the top
        if (sortedGradientStops.length > 0 && sortedGradientStops[sortedGradientStops.length - 1].stop < 1) {
             gradientCssString += `, ${sortedGradientStops[sortedGradientStops.length - 1].color} 100%`;
        }
        gradientCssString += ')';
        
        legendHtml += `<div class="legend-gradient-bar" style="background: ${gradientCssString};"></div>`;

        // Create labels for 0% and 100%
        // The labels now represent the normalized intensity of the heatmap itself (0 to 1, or 0% to 100%)
        legendHtml += '<div class="legend-labels">';
        legendHtml += '<span>100%</span>'; // Top label
        legendHtml += '<span>50%</span>';  // Middle label (approx)
        legendHtml += '<span>0%</span>';   // Bottom label
        legendHtml += '</div>'; // End legend-labels

        legendHtml += '</div>'; // End legend-body

        div.innerHTML = legendHtml;
        return div;
    };

    legend.addTo(mapInstance);
    console.log("Vertical gradient heatmap legend added to map.");
}

// --- Data Processing Function ---
// This function is no longer needed as data processing is handled by the backend
// and initial filter population is handled by initializeApplicationStateAndLoadData
/*
function processLoadedData(parsedData) {
    console.log("Processing loaded data...");
    const processedData = [];
    uniqueYears.clear();
    uniqueDomains.clear();

    parsedData.forEach(row => {
        const lat = parseFloat(row.latitude);
        const lon = parseFloat(row.longitude);
        const year = parseInt(row.publication_year, 10);

        if (isNaN(lat) || isNaN(lon) || isNaN(year)) {
            return;
        }
        
        const categoriesStr = row.arxiv_categories || '';
        const categories = categoriesStr.split(' ').filter(cat => cat.trim() !== '');
        
        const record = {
            lat: lat,
            lon: lon,
            year: year,
            categories: categories,
            arxiv_categories_raw: row.arxiv_categories || '', 
            country_code: row.country_code ? row.country_code.trim() : 'Unknown',
            city: row.city ? row.city.trim() : 'Unknown',
            title: row.title || 'No Title', 
            arxiv_id: row.arxiv_id || null,
            institution_name: row.institution_name ? row.institution_name.trim() : 'Unknown Institution'
        };
        
        processedData.push(record);
        uniqueYears.add(year);
        
        categories.forEach(cat => {
            if (cat && cat.trim() !== '') {
                uniqueDomains.add(cat);
            }
        });
    });

    allPublicationData = processedData;
    console.log(`Processing complete. ${allPublicationData.length} valid records stored.`);
    
    const yearsArraySorted = Array.from(uniqueYears).sort((a, b) => a - b); 
    if (yearsArraySorted.length > 0) { 
        globalMinYear = yearsArraySorted[0]; 
        globalMaxYear = yearsArraySorted[yearsArraySorted.length - 1]; 
        // Set default year to 2024 if available, otherwise to globalMaxYear
        if (yearsArraySorted.includes(2024)) {
            currentSelectedYear = 2024;
        } else {
            currentSelectedYear = globalMaxYear; // Fallback to max year if 2024 not present
        }
    } else { 
        globalMinYear = null; 
        globalMaxYear = null; 
        currentSelectedYear = null; 
    }
    
    console.log("Determined Year Range: Min=", globalMinYear, "Max=", globalMaxYear, "Default Selected Year=", currentSelectedYear);
    
    populateFilterControls(); // This will also set the slider to currentSelectedYear
    
    applyFilters(); // Initial data load and map update

    setupMapClickPopup();
}
*/

// --- Function to Extract Unique Domains ---
function extractDomains() {
    console.log("Extracting unique domains from global uniqueDomains set...");
    return Array.from(uniqueDomains).sort();
}

// --- Data Loading Function ---
// This function is replaced by initializeApplicationStateAndLoadData
/*
function loadData() {
    const dataFilePath = 'data/arxiv_locations_geocoded.csv';
    console.log(`Attempting to load data from: ${dataFilePath}`);
    
    // Mostrar indicador de carga
    showLoadingIndicator();

    Papa.parse(dataFilePath, {
        download: true,
        header: true,
        skipEmptyLines: true,
        // Eliminamos el límite de preview para cargar todos los datos disponibles
        // preview: 50000, 
        complete: function(results) {
            console.log(`CSV parsing complete. Processing ${results.data.length} rows.`);
            if (results.errors.length > 0) {
                console.error("Errors during CSV parsing:", results.errors);
            }
            // Header validation
            if (!results.meta || !results.meta.fields || !results.meta.fields.includes('latitude') || !results.meta.fields.includes('longitude') || !results.meta.fields.includes('publication_year')) {
                console.error('Error: CSV missing essential headers (latitude, longitude, publication_year).');
                hideLoadingIndicator();
                return;
            }
            processLoadedData(results.data);
            hideLoadingIndicator();
        },
        error: function(error, file) {
            console.error("Critical error loading or parsing CSV:", error, file);
            hideLoadingIndicator();
        }
    });
}
*/

// Funciones para mostrar/ocultar indicador de carga
function showLoadingIndicator() {
    console.log("Loading data, please wait...");
    if (!document.getElementById('loading-indicator')) {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-indicator';
        loadingDiv.innerHTML = 'Loading all data, please wait...';
        loadingDiv.style.position = 'absolute';
        loadingDiv.style.top = '50%';
        loadingDiv.style.left = '50%';
        loadingDiv.style.transform = 'translate(-50%, -50%)';
        loadingDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        loadingDiv.style.color = 'white';
        loadingDiv.style.padding = '20px';
        loadingDiv.style.borderRadius = '5px';
        loadingDiv.style.zIndex = '1000';
        document.body.appendChild(loadingDiv);
    } else {
        document.getElementById('loading-indicator').style.display = 'block';
    }
}

function hideLoadingIndicator() {
    console.log("Data loading complete!");
    const indicator = document.getElementById('loading-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

// --- Heatmap Data Transformation Function ---
function transformDataForHeatmap(dataPoints) {
    console.log(`Transforming ${dataPoints.length} data points for heatmap...`);
    const locationCounts = new Map();

    dataPoints.forEach(p => {
        if (p.lat === undefined || p.lon === undefined) { // Check for undefined lat/lon
            // console.warn("Skipping data point with undefined lat/lon:", p); // Optional: for debugging
            return;
        }
        const key = `${p.lat},${p.lon}`;
        if (locationCounts.has(key)) {
            locationCounts.set(key, locationCounts.get(key) + 1);
        } else {
            locationCounts.set(key, 1);
        }
    });

    const latLngIntensityArray = [];
    locationCounts.forEach((count, key) => {
        const [latStr, lonStr] = key.split(',');
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        
        if (isNaN(lat) || isNaN(lon)) { // Additional check after split/parse
            // console.warn("Skipping data point with NaN lat/lon after parsing key:", key); // Optional: for debugging
            return;
        }

        // Intensity relative, maximum around 1.0 for the most frequent points
        // This can be adjusted based on visual preference
        const intensity = Math.min(count / 5, 1.0); // Original intensity logic
        latLngIntensityArray.push([lat, lon, intensity]);
    });

    console.log(`Transformation complete. ${latLngIntensityArray.length} unique locations with intensity.`);
    return latLngIntensityArray;
}

// --- Statistics Panel Update Function ---
function updateStatisticsPanel(filteredData) {
    console.log("Updating statistics panel...");
    const totalPublicationsEl = document.getElementById('stats-total-publications');
    const topCountriesEl = document.getElementById('stats-top-countries');
    const topCitiesListEl = document.getElementById('stats-top-cities-list');
    const timePeriodEl = document.getElementById('stats-time-period');

    if (!totalPublicationsEl || !topCountriesEl || !topCitiesListEl || !timePeriodEl) {
        console.error("Statistics panel elements not found!");
        return;
    }

    // 1. Total Publications
    totalPublicationsEl.textContent = filteredData.length;

    // 2. Top Countries (using country_code)
    const countryCounts = filteredData.reduce((acc, item) => {
        const country = item.country_code || 'Unknown'; 
        acc[country] = (acc[country] || 0) + 1;
        return acc;
    }, {});

    const sortedCountries = Object.entries(countryCounts)
        .sort(([, aCount], [, bCount]) => bCount - aCount)
        .slice(0, 3);

    topCountriesEl.innerHTML = ''; // Clear previous list
    if (sortedCountries.length > 0) {
        sortedCountries.forEach(([country, count]) => {
            const listItem = document.createElement('li');
            listItem.textContent = `${country}: ${count}`;
            topCountriesEl.appendChild(listItem);
        });
    } else {
        topCountriesEl.innerHTML = '<li>N/A</li>';
    }

    // 3. Top Cities (using city field)
    const cityCounts = filteredData.reduce((acc, item) => {
        const city = item.city || 'Unknown'; // Use city field
        acc[city] = (acc[city] || 0) + 1;
        return acc;
    }, {});

    const sortedCities = Object.entries(cityCounts)
        .sort(([, aCount], [, bCount]) => bCount - aCount)
        .slice(0, 3);

    topCitiesListEl.innerHTML = ''; // Clear previous list
    if (sortedCities.length > 0) {
        sortedCities.forEach(([city, count]) => {
            const listItem = document.createElement('li');
            // Avoid showing "Unknown: count" if it's the only or a dominant result
            if (city.toLowerCase() === 'unknown' && sortedCities.length === 1 && count === filteredData.length) {
                 listItem.textContent = 'N/A (city data sparse)';
            } else {
                 listItem.textContent = `${city}: ${count}`;
            }
            topCitiesListEl.appendChild(listItem);
        });
    } else {
        topCitiesListEl.innerHTML = '<li>N/A</li>';
    }

    // 4. Time Period
    if (currentSelectedYear) {
        timePeriodEl.textContent = currentSelectedYear;
    } else {
        // If no specific year is selected, try to determine range from filteredData
        const yearsInData = new Set(filteredData.map(item => item.year));
        const sortedYears = Array.from(yearsInData).sort((a, b) => a - b);
        if (sortedYears.length > 0) {
            const min = sortedYears[0];
            const max = sortedYears[sortedYears.length - 1];
            timePeriodEl.textContent = (min === max) ? `${min}` : `${min} - ${max}`;
        } else {
            timePeriodEl.textContent = 'N/A';
        }
    }
    console.log("Statistics panel updated.");
}

// --- Constants for DBSCAN clustering ---
const DBSCAN_MAX_DISTANCE_KM = 75; // Maximum distance in kilometers for points to be considered in the same cluster
const DBSCAN_MIN_POINTS = 5;    // Minimum number of points to form a cluster

// Function to calculate the centroid of an array of points
function calculateCentroid(points) {
    if (!points || points.length === 0) return null;
    let sumLat = 0;
    let sumLon = 0;
    points.forEach(p => {
        sumLat += p.lat;
        sumLon += p.lon;
    });
    return { lat: sumLat / points.length, lon: sumLon / points.length };
}

// Function to find the most frequent city in a set of points
function findMostFrequentCity(points) {
    if (!points || points.length === 0) return "N/A";
    const cityCounts = {};
    points.forEach(p => {
        if (p.city && p.city !== 'Unknown') {
            cityCounts[p.city] = (cityCounts[p.city] || 0) + 1;
        }
    });
    if (Object.keys(cityCounts).length === 0) return "N/A (multiple small locations)";
    
    return Object.entries(cityCounts).reduce((a, b) => a[1] > b[1] ? a : b)[0];
}

// --- Apply Filters Function ---
async function applyFilters() { // Made async to use await for fetch
    console.log("Applying filters via backend...");
    console.log(`Current filters - Year: ${currentSelectedYear}, Domain: ${currentSelectedDomain || "All"}`);
    
    // showLoadingIndicator(); // No longer show indicator on every filter change
    
    // Ensure a year is selected; if not, default or prevent call.
    // For now, we rely on currentSelectedYear being set by slider/initial load.
    if (currentSelectedYear === null) {
        console.warn("No year selected. Aborting applyFilters to backend.");
        // Optionally clear map layers or show a message
        heatLayer.setLatLngs([]);
        hotspotMarkersLayer.clearLayers();
        clusterAreaLayer.clearLayers();
        updateStatisticsPanel([]); 
        hideLoadingIndicator();
        return;
    }

    let apiUrl = `http://localhost:3001/api/cluster?year=${currentSelectedYear}`; // New URL, points to backend server
    if (currentSelectedDomain && currentSelectedDomain !== "all") {
        apiUrl += `&domain=${encodeURIComponent(currentSelectedDomain)}`;
    }

    try {
        console.log(`Fetching from backend: ${apiUrl}`);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            console.error(`Error fetching cluster data from backend: ${response.status}`, errorData);
            alert(`Failed to load hotspot data from server: ${errorData.message || response.statusText}`);
            // Clear map on error
            heatLayer.setLatLngs([]);
            hotspotMarkersLayer.clearLayers();
            clusterAreaLayer.clearLayers();
            updateStatisticsPanel([]);
            filteredDataGlobal = [];
            hideLoadingIndicator();
            return;
        }

        const hotspotDataFromBackend = await response.json();
        console.log(`Received ${hotspotDataFromBackend.length} hotspots from backend.`);

        // The backend now returns "hotspots" which are essentially pre-clustered groups.
        // We need to extract all individual publications from these hotspots for the heatmap
        // and for the generic map click popup.
        
        filteredDataGlobal = []; // Reset global filtered data
        if (hotspotDataFromBackend.length > 0) {
            hotspotDataFromBackend.forEach(hotspot => {
                if (hotspot.publications && Array.isArray(hotspot.publications)) {
                    filteredDataGlobal.push(...hotspot.publications);
                }
            });
        }
        console.log(`Total individual publications from hotspots for heatmap/stats: ${filteredDataGlobal.length}`);

        updateHeatmap(filteredDataGlobal); // Heatmap uses all individual points from the returned clusters
        updateHotspotMarkers(hotspotDataFromBackend); // Markers and polygons use the processed hotspot objects
        updateStatisticsPanel(filteredDataGlobal); // Stats panel also uses individual points

    } catch (error) {
        console.error("Failed to fetch or process data from backend:", error);
        alert("An error occurred while fetching data. Please try again.");
        // Clear map on critical error
        heatLayer.setLatLngs([]);
        hotspotMarkersLayer.clearLayers();
        clusterAreaLayer.clearLayers();
        updateStatisticsPanel([]);
        filteredDataGlobal = [];
    } finally {
        hideLoadingIndicator();
    }
    console.log("Application initialized.");
}

// --- Heatmap Update Function ---
function updateHeatmap(dataPoints) {
    console.log(`Updating heatmap with ${dataPoints.length} raw points.`);
    // showLoadingIndicator(); // Moved to applyFilters to cover transformation time too

    const heatmapData = transformDataForHeatmap(dataPoints);

    if (heatmapData.length > 0) {
        heatLayer.setLatLngs(heatmapData);
        console.log("Heatmap layer updated with transformed and weighted points.");
    } else {
        heatLayer.setLatLngs([]); // Clear heatmap if no data
        console.log("Heatmap layer cleared as there are no valid points after transformation or filters.");
    }
    hideLoadingIndicator(); // Hide indicator after heatmap is updated or cleared
}

// --- UI Population and Event Listener Functions ---
function populateFilterControls() {
    console.log("Populating filter controls...");
    populateDomainFilter();
    populateYearSlider();
    setupEventListeners();
}

function setupEventListeners() {
    console.log("Setting up event listeners...");
    
    // Year slider event listener
    const yearSlider = document.getElementById('year-slider');
    const yearDisplay = document.getElementById('year-display');
    
    if (yearSlider && yearDisplay) {
        yearSlider.addEventListener('input', function() {
            yearDisplay.textContent = this.value;
            if (isAnimating) pauseYearAnimation(); // Pause animation if user manually changes slider
        });
        yearSlider.addEventListener('change', function() {
            console.log(`Year slider value changed to: ${this.value}`);
            currentSelectedYear = parseInt(this.value, 10);
            if (isAnimating) pauseYearAnimation(); // Ensure animation is paused
            applyFilters();
        });
        yearSlider.addEventListener('mousedown', function() {
            yearDisplay.style.color = '#FF5722';
        });
        yearSlider.addEventListener('mouseup', function() {
            yearDisplay.style.color = '#4CAF50';
        });
    }
    
    // Domain filter event listener
    const domainFilter = document.getElementById('domain-filter');
    if (domainFilter) {
        domainFilter.addEventListener('change', function(event) {
            console.log(`Domain filter changed to: ${event.target.value || "All Domains"}`);
            currentSelectedDomain = event.target.value;
            if (isAnimating) pauseYearAnimation(); // Pause animation if user changes domain
            applyFilters();
        });
    }

    // Animation Play/Pause button event listener
    const playPauseBtn = document.getElementById('play-pause-animation-btn');
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', toggleYearAnimation);
    }

    // Collapsible filters button event listener
    const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
    const collapsibleContent = document.getElementById('collapsible-filters-content');

    if (toggleFiltersBtn && collapsibleContent) {
        toggleFiltersBtn.addEventListener('click', function() {
            collapsibleContent.classList.toggle('expanded');
            // Optional: Change button text or icon based on state
            if (collapsibleContent.classList.contains('expanded')) {
                this.textContent = 'Hide Filters & Stats';
            } else {
                this.textContent = 'Show Filters & Stats';
            }
        });

        // Check initial screen width to set default state
        if (window.innerWidth <= 768) {
            collapsibleContent.classList.remove('expanded');
            toggleFiltersBtn.textContent = 'Show Filters & Stats';
        } else {
            // On larger screens, ensure filters are expanded by default and button might not be needed
            // (CSS handles hiding the button, but JS can ensure content is visible)
            collapsibleContent.classList.add('expanded');
        }
    }
}

function populateDomainFilter() {
    console.log("Populating domain filter...");
    const domainFilterSelect = document.getElementById('domain-filter');
    if (!domainFilterSelect) {
        console.error("Domain filter select element not found!");
        return;
    }
    
    domainFilterSelect.innerHTML = '';
    
    // Add "All Domains" option
    const allDomainsOption = document.createElement('option');
    allDomainsOption.value = "";
    allDomainsOption.textContent = "All Domains";
    domainFilterSelect.appendChild(allDomainsOption);
    
    // Get and sort unique domains
    const sortedUniqueDomains = extractDomains();
    
    // Add an option for each domain
    sortedUniqueDomains.forEach(domain => {
        const option = document.createElement('option');
        option.value = domain;
        option.textContent = domain;
        domainFilterSelect.appendChild(option);
    });
    
    console.log(`Domain filter populated with ${sortedUniqueDomains.length} unique domains.`);
}

function populateYearSlider() {
    console.log("Populating year slider...");
    const yearSlider = document.getElementById('year-slider');
    const yearDisplay = document.getElementById('year-display');
    
    if (!yearSlider || !yearDisplay) {
        console.error("Year slider or display element not found!");
        return;
    }
    
    if (globalMinYear !== null && globalMaxYear !== null) {
        yearSlider.min = globalMinYear;
        yearSlider.max = globalMaxYear;
        yearSlider.value = currentSelectedYear !== null ? currentSelectedYear : globalMaxYear;
        yearDisplay.textContent = yearSlider.value;
        yearSlider.disabled = false;
        console.log(`Year slider configured: Min=${globalMinYear}, Max=${globalMaxYear}, Value=${yearSlider.value}`);
    } else {
        yearDisplay.textContent = "N/A";
        yearSlider.disabled = true;
        yearSlider.min = "2000";
        yearSlider.max = "2023";
        yearSlider.value = "2023";
        console.log("Year slider disabled as no year data is available.");
    }
}

// --- Map Click Interaction for Popups ---
function setupMapClickPopup() {
    const searchRadiusMeters = 50000; // 50 km, adjust as needed

    map.on('click', function(e) {
        // Prevent click if it was on a hotspot marker or polygon, as they have their own popups
        if (e.originalEvent.target.closest('.leaflet-marker-icon') || e.originalEvent.target.closest('.leaflet-interactive')) {
            // Check if the click was on an actual polygon of a cluster, not just the map layer itself
            if (e.originalEvent.target.classList && e.originalEvent.target.classList.contains('leaflet-interactive')) {
                 // Further check if it's one of our cluster polygons (which should have a popup)
                 // This check might be too broad, ideally we'd check if the target *is* one of our polygons in clusterAreaLayer
                 // For now, if it's an interactive layer, assume it has its own popup.
                return; 
            }
        }

        console.log("Map clicked at: ", e.latlng);
        const clickedLatLng = e.latlng;

        const nearbyPoints = findNearbyPoints(clickedLatLng, searchRadiusMeters, filteredDataGlobal); 

        const popupContent = formatUnifiedPopupContent(nearbyPoints, clickedLatLng.lat + ", " + clickedLatLng.lng);
        
        L.popup()
            .setLatLng(clickedLatLng)
            .setContent(popupContent)
            .openOn(map);
    });

    console.log("Map click listener for general popups setup complete.");
}

function findNearbyPoints(clickedLatLng, searchRadiusMeters, dataToSearch) {
    const nearby = [];
    if (!dataToSearch || dataToSearch.length === 0) {
        console.log("No data provided to search for nearby points.");
        return nearby;
    }

    dataToSearch.forEach(point => {
        if (point.lat === undefined || point.lon === undefined) return;
        const pointLatLng = L.latLng(point.lat, point.lon);
        const distance = clickedLatLng.distanceTo(pointLatLng); // Distance in meters

        if (distance <= searchRadiusMeters) {
            nearby.push(point);
        }
    });
    console.log(`Found ${nearby.length} points within ${searchRadiusMeters / 1000}km radius.`);
    return nearby;
}

function formatUnifiedPopupContent(points, areaName) {
    if (!points || points.length === 0) {
        return `<div class="map-popup-content"><h4>${areaName} Details</h4><p>No publication data available for this specific selection.</p></div>`;
    }

    let content = `<div class="map-popup-content"><h4>${areaName} Details</h4>`;
    content += `<p>Approx. <strong>${points.length}</strong> publication(s) considered in this area.</p>`;

    // 1. Top Categories
    const categoryCounts = points.reduce((acc, p) => {
        (p.categories || []).forEach(cat => {
            acc[cat] = (acc[cat] || 0) + 1;
        });
        return acc;
    }, {});
    const sortedCategories = Object.entries(categoryCounts).sort((a,b) => b[1] - a[1]).slice(0,3);
    if(sortedCategories.length > 0){
        content += "<p><strong>Top categories:</strong><br>";
        sortedCategories.forEach(([cat, count]) => {
            content += `<span>${cat} (${count})</span><br>`; // Using span for better styling potential
        });
        content += "</p>";
    } else {
        content += "<p><strong>Top categories:</strong> N/A</p>";
    }

    // 2. Top Cities
    const cityCounts = points.reduce((acc, p) => { 
        const city = p.city || 'Unknown City';
        acc[city] = (acc[city] || 0) + 1;
        return acc;
    }, {});
    const sortedCities = Object.entries(cityCounts).sort((a,b) => b[1] - a[1]).slice(0,3);
    if(sortedCities.length > 0){
        content += "<p><strong>Top Cities:</strong><br>";
        sortedCities.forEach(([city, count]) => {
            content += `<span>${city} (${count})</span><br>`;
        });
        content += "</p>";
    }

    // 3. Top Institutions
    const institutionCounts = points.reduce((acc, p) => {
        const institution = p.institution_name || 'Unknown Institution';
        // Avoid counting 'Unknown Institution' if it's the only one or not meaningful
        if (institution !== 'Unknown Institution' || points.length === 1) {
             acc[institution] = (acc[institution] || 0) + 1;
        }
        return acc;
    }, {});
    const sortedInstitutions = Object.entries(institutionCounts)
        .filter(([name, count]) => name !== 'Unknown Institution' || count === points.length) // Filter out 'Unknown' unless it's all we have
        .sort((a,b) => b[1] - a[1])
        .slice(0,3);
        
    if(sortedInstitutions.length > 0 && !(sortedInstitutions.length === 1 && sortedInstitutions[0][0] === 'Unknown Institution' && sortedInstitutions[0][1] < points.length && points.length > 1) ){
        content += "<p><strong>Top Institutions:</strong><br>";
        sortedInstitutions.forEach(([institution, count]) => {
            content += `<span>${institution} (${count})</span><br>`;
        });
        content += "</p>";
    } else if (points.length > 0) {
        // Optionally, indicate if institution data is sparse or not available
        // content += "<p><strong>Top Institutions:</strong> Data not available or sparse</p>"; 
    }

    // 4. Sample Titles
    content += "<p><strong>Sample Titles (up to 3 unique):</strong></p><ul>";
    const uniqueTitlesWithIds = [];
    const seenTitles = new Set();
    for (const p of points) {
        if (uniqueTitlesWithIds.length >= 3) break;
        const currentTitle = p.title || "No Title";
        if (!seenTitles.has(currentTitle)) {
            seenTitles.add(currentTitle);
            uniqueTitlesWithIds.push({ 
                title: currentTitle, 
                arxiv_id: p.arxiv_id
            });
        }
    }

    if (uniqueTitlesWithIds.length > 0) {
        uniqueTitlesWithIds.forEach(item => {
            if (item.arxiv_id) {
                content += `<li><a href="https://arxiv.org/abs/${item.arxiv_id}" target="_blank">${item.title}</a></li>`;
            } else {
                content += `<li>${item.title} (ID not available)</li>`;
            }
        });
    } else {
        content += "<li>No unique titles available in this selection.</li>";
    }
    content += "</ul>";
    content += "</div>";
    return content;
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed.");
    showLoadingIndicator();
    initializeApplicationStateAndLoadData(); // Nueva función central
});

async function initializeApplicationStateAndLoadData() {
    console.log("Initializing application state and loading initial data...");
    // 1. Set initial default filter values
    globalMinYear = 2007; 
    globalMaxYear = new Date().getFullYear(); 
    
    // Try to set to 2024, if not in range, use max year.
    if (globalMaxYear >= 2024 && globalMinYear <= 2024) {
        currentSelectedYear = 2024;
    } else {
        currentSelectedYear = globalMaxYear;
    }
    
    uniqueDomains.clear(); 
    currentSelectedDomain = ""; 
    
    // 2. Populate filter controls with these initial defaults
    populateFilterControls(); 
    setupEventListeners(); 

    // 3. Make the first call to applyFilters to get data from backend
    await applyFilters(); 

    // 4. After the first data load, update filter options based on actual data received
    if (filteredDataGlobal.length > 0) {
        console.log("Updating filter options based on first data load...");
        const actualDomainsInternal = new Set(); // Use a local set for this scope

        filteredDataGlobal.forEach(p => {
            (p.categories || []).forEach(cat => {
                if (cat && cat.trim() !== '') {
                    actualDomainsInternal.add(cat);
                }
            });
        });

        // Update the global uniqueDomains set which is used by extractDomains -> populateDomainFilter
        uniqueDomains.clear(); // Clear before adding new ones
        actualDomainsInternal.forEach(domain => uniqueDomains.add(domain));
        console.log(`Actual unique domains found: ${uniqueDomains.size}`);

        // Repopulate controls with actual data ranges and options
        populateDomainFilter();
        // Ensure the year slider still reflects the currentSelectedYear, in case it was adjusted by logic above (though that logic is now commented out)
        // Or, if currentSelectedYear might change for other reasons and needs to update the slider display:
        const yearSlider = document.getElementById('year-slider');
        const yearDisplay = document.getElementById('year-display');
        if (yearSlider && yearDisplay && yearSlider.value !== String(currentSelectedYear)) {
            yearSlider.value = currentSelectedYear;
            yearDisplay.textContent = currentSelectedYear;
        }

        console.log("Domain filter repopulated with actual data. Year slider retains its broad range.");
    } else {
        console.log("No data returned from initial load, filter options remain as defaults.");
    }

    // 5. Setup map click popups
    setupMapClickPopup();

    // 6. Hide loading indicator 
    // (applyFilters also has a finally block, this ensures it's hidden if applyFilters had an early exit or error not caught by its own finally)
    hideLoadingIndicator();
    console.log("Application initialized.");
}

// --- Animation Functions ---
function toggleYearAnimation() {
    if (isAnimating) {
        pauseYearAnimation();
    } else {
        startYearAnimation();
    }
}

function startYearAnimation() {
    const yearSlider = document.getElementById('year-slider');
    const playPauseBtn = document.getElementById('play-pause-animation-btn');

    if (!yearSlider || !playPauseBtn) return;

    isAnimating = true;
    playPauseBtn.textContent = "Pause";
    playPauseBtn.classList.add("playing");
    yearSlider.disabled = true; // Optionally disable slider during animation
    document.getElementById('domain-filter').disabled = true; // Optionally disable domain filter

    console.log("Starting year animation.");

    animationIntervalId = setInterval(async () => {
        await advanceYearAndFilter();
    }, animationSpeed);
}

function pauseYearAnimation() {
    const yearSlider = document.getElementById('year-slider');
    const playPauseBtn = document.getElementById('play-pause-animation-btn');

    if (!yearSlider || !playPauseBtn) return;

    isAnimating = false;
    clearInterval(animationIntervalId);
    animationIntervalId = null;
    playPauseBtn.textContent = "Play";
    playPauseBtn.classList.remove("playing");
    yearSlider.disabled = false;
    document.getElementById('domain-filter').disabled = false;
    console.log("Year animation paused.");
}

async function advanceYearAndFilter() {
    const yearSlider = document.getElementById('year-slider');
    const yearDisplay = document.getElementById('year-display');

    if (!yearSlider || !yearDisplay) return;

    let nextYear = parseInt(yearSlider.value) + 1;
    if (nextYear > parseInt(yearSlider.max)) {
        nextYear = parseInt(yearSlider.min); // Loop back to min year
    }

    currentSelectedYear = nextYear;
    yearSlider.value = currentSelectedYear;
    yearDisplay.textContent = currentSelectedYear;
    console.log(`Animation: Advancing to year ${currentSelectedYear}`);

    // showLoadingIndicator(); // No longer show indicator during animation year change
    await applyFilters();
    // hideLoadingIndicator(); // applyFilters already has a finally block to hide it
}

// Adjusting when setupMapClickPopup is called.
// It should be after the map is initialized AND data is loaded/filtered initially so filteredDataGlobal is populated.
// Modifying processLoadedData to call it.

function initializeMap() {
    // Initialize the map
    map = L.map('map-container').setView([20, 0], 2); // Centered globally, adjust as needed

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        minZoom: 2,
        maxZoom: 18
    }).addTo(map);

    // Add zoom and scale controls
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ position: 'bottomleft' }).addTo(map);
    
    console.log("Leaflet map initialized with zoom and scale controls.");

    // --- Initialize Heatmap Layer ---
    // const heatLayer = L.heatLayer([], getHeatmapOptions()).addTo(map);
    // console.log("Leaflet.heat layer initialized with dynamic options.");
    // The heatLayer is initialized globally and added to the map later or when data is ready.
    // For now, we ensure it's globally accessible if needed before data loading.
    // window.heatLayer = L.heatLayer([], getHeatmapOptions()); 
    // window.heatLayer.addTo(map);
    // console.log("Global heatLayer initialized and added to map.");

    // Add the legend to the map
    // addHeatmapLegend(map, getHeatmapOptions()); // This call is being moved to the global scope after heatLayer initialization
}

// --- Function to update hotspot markers on the map (Opción 3) ---
function updateHotspotMarkers(hotspotData) {
    console.log(`Updating hotspot markers and areas with ${hotspotData.length} hotspots...`);
    hotspotMarkersLayer.clearLayers();
    clusterAreaLayer.clearLayers(); // Clear the polygon layer as well

    if (!hotspotData || !Array.isArray(hotspotData)) {
        console.warn("updateHotspotMarkers received invalid or no hotspotData. Clearing layers.");
        return;
    }

    hotspotData.forEach(hotspot => {
        if (!hotspot || !hotspot.centroid || !Array.isArray(hotspot.centroid) || hotspot.centroid.length < 2) {
            console.warn("Skipping invalid hotspot entry:", hotspot);
            return;
        }
        const markerLatLng = L.latLng(hotspot.centroid[1], hotspot.centroid[0]); 
        const markerOptions = {
            radius: 5 + Math.log2(hotspot.publicationCount),
            fillColor: "#ff7800", 
            color: "#000",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.7
        };
        const marker = L.circleMarker(markerLatLng, markerOptions);

        // Use the new unified popup content function
        // Pass hotspot.publications and the city name (or a default) as areaName
        const areaDisplayName = hotspot.city && hotspot.city !== 'Unknown City' ? hotspot.city : "Clustered Area";
        const popupContent = formatUnifiedPopupContent(hotspot.publications, areaDisplayName);

        marker.bindPopup(popupContent);
        marker.addTo(hotspotMarkersLayer);

        if (hotspot.clusterPolygon && hotspot.clusterPolygon.geometry) {
            const polygonStyle = {
                fillColor: "#4a8afc",
                fillOpacity: Math.min(0.1 + (hotspot.publicationCount / 50), 0.4),
                color: "#4a8afc",
                weight: 1.5,
                opacity: 0.6
            };
            L.geoJSON(hotspot.clusterPolygon, { style: polygonStyle })
             .bindPopup(popupContent) 
             .addTo(clusterAreaLayer);
        } else {
            console.warn(`Skipping polygon for hotspot id ${hotspot.id} because clusterPolygon is missing or invalid.`);
        }
    });
    console.log(`${hotspotData.length} hotspot markers and areas updated/added.`);
} 