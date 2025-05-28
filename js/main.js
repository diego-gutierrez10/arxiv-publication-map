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
function getHeatmapOptions() {
    // These options can be tuned for optimal visualization
    return {
        radius: 25,         // Size of each data point on the map.
        blur: 15,           // Amount of blur applied to the heatmap points.
        maxZoom: 18,        // Zoom level after which the heatmap will not be displayed.
                            // Useful for performance with many points at high zoom.
        gradient: {         // Defines the color gradient of the heatmap.
                            // Keys are stop points (0.0 to 1.0), values are colors.
            0.33: 'blue',    // Start with blue at the very bottom
            0.66: 'lime',    // Lime exactly at the midpoint (50%)
            1.0: 'red'        // End with red at the very top
        },
        max: 0.5,           // Global maximum intensity value for the heatmap. 
                            // Can be adjusted based on data density to make hotspots more/less prominent.
        minOpacity: 0.4     // Minimum opacity of the heatmap layer.
    };
}

// --- Initialize Heatmap Layer ---
// /* // Temporarily commented out for memory debugging (Still commented) // This was the start of the heatlayer block comment
const heatLayer = L.heatLayer([], getHeatmapOptions()).addTo(map); // RESTORING & using getHeatmapOptions
console.log("Leaflet.heat layer initialized with dynamic options."); // RESTORING

// Add the legend to the map globally after map and heatLayer are initialized
addHeatmapLegend(map, getHeatmapOptions());
// */ // This was the end of the Leaflet init block, other functions remain commented below -> this should be the end of heatlayer block comment

// --- Add Heatmap Legend ---
function addHeatmapLegend(mapInstance, heatmapOptions) {
    const legend = L.control({ position: 'bottomright' });

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
        
        // Extract domains from arxiv_categories
        const categoriesStr = row.arxiv_categories || '';
        const categories = categoriesStr.split(' ').filter(cat => cat.trim() !== '');
        
        // Add record to processed data
        const record = {
            lat: lat,
            lon: lon,
            year: year,
            categories: categories,
            arxiv_categories_raw: row.arxiv_categories || '', 
            country_code: row.country_code ? row.country_code.trim() : 'Unknown',
            city: row.city ? row.city.trim() : 'Unknown',
            title: row.title || 'No Title', 
        };
        
        processedData.push(record);
        uniqueYears.add(year);
        
        // Add each category to unique domains
        categories.forEach(cat => {
            if (cat && cat.trim() !== '') {
                uniqueDomains.add(cat);
            }
        });
    });

    allPublicationData = processedData;
    console.log(`Processing complete. ${allPublicationData.length} valid records stored.`);
    
    // Determine and store global year range
    const yearsArraySorted = Array.from(uniqueYears).sort((a, b) => a - b); 
    if (yearsArraySorted.length > 0) { 
        globalMinYear = yearsArraySorted[0]; 
        globalMaxYear = yearsArraySorted[yearsArraySorted.length - 1]; 
        currentSelectedYear = globalMaxYear; // Default to most recent year
    } else { 
        globalMinYear = null; 
        globalMaxYear = null; 
        currentSelectedYear = null; 
    }
    
    console.log("Determined Year Range: Min=", globalMinYear, "Max=", globalMaxYear, "Default Selected Year=", currentSelectedYear);
    
    // Update UI controls with the processed data
    populateFilterControls();
    
    // Apply initial filters and update heatmap (which will also update statistics)
    applyFilters();
}

// --- Function to Extract Unique Domains ---
function extractDomains(data) {
    console.log("Extracting unique domains...");
    return Array.from(uniqueDomains).sort();
}

// --- Data Loading Function ---
function loadData() {
    const dataFilePath = 'https://media.githubusercontent.com/media/diego-gutierrez10/arxiv-publication-map/main/data/arxiv_locations_geocoded.csv';
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
            
            // Logsito
            // DEBUG: Log the detected headers (meta.fields) and the first few rows of data
            console.log("Detected headers (results.meta.fields):", results.meta ? results.meta.fields : "meta not available");
            console.log("First 5 rows of parsed data (results.data.slice(0, 5)):", results.data.slice(0, 5));
            console.log("All meta information from PapaParse:", results.meta);

            if (results.errors.length > 0) {
                console.error("Errors during CSV parsing:", results.errors);
            }
            // Header validation
            if (!results.meta || !results.meta.fields || !results.meta.fields.includes('latitude') || !results.meta.fields.includes('longitude') || !results.meta.fields.includes('publication_year')) {
                console.error('Error: CSV missing essential headers (latitude, longitude, publication_year). The headers found were: ' + (results.meta && results.meta.fields ? results.meta.fields.join(', ') : 'none or meta not available')); // Enhanced error message
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

// --- Apply Filters Function ---
function applyFilters() {
    console.log("Applying filters...");
    console.log(`Current filters - Year: ${currentSelectedYear}, Domain: ${currentSelectedDomain || "All"}`);
    
    showLoadingIndicator(); // Show loading indicator before filtering

    // Start with all data
    let filteredData = allPublicationData;
    
    // Apply year filter if a year is selected
    if (currentSelectedYear !== null) {
        filteredData = filteredData.filter(item => item.year === currentSelectedYear);
        console.log(`After year filter (${currentSelectedYear}): ${filteredData.length} items`);
    }
    
    // Apply domain filter if a domain is selected (and it's not "All Domains")
    if (currentSelectedDomain && currentSelectedDomain !== "") { // "" corresponds to "All Domains"
        filteredData = filteredData.filter(item => 
            item.categories && item.categories.includes(currentSelectedDomain)
        );
        console.log(`After domain filter ('${currentSelectedDomain}'): ${filteredData.length} items`);
    }
    
    console.log(`Total filtered data contains ${filteredData.length} points.`);
    
    // Update statistics panel with filtered data
    updateStatisticsPanel(filteredData); // Call to update statistics

    // Update heatmap with filtered data
    // Encapsulate heatmap update in a timeout to allow UI to update (show loading indicator)
    setTimeout(() => {
        updateHeatmap(filteredData);
        // hideLoadingIndicator(); // Hide indicator is now in updateHeatmap
    }, 10); // Small delay to ensure loading indicator renders
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
    
    // Year slider event listener - Implementación mejorada
    const yearSlider = document.getElementById('year-slider');
    const yearDisplay = document.getElementById('year-display');
    
    if (yearSlider && yearDisplay) {
        // Evento input: actualización en tiempo real mientras se arrastra
        yearSlider.addEventListener('input', function() {
            yearDisplay.textContent = this.value;
            // No aplicamos el filtro aquí para evitar demasiadas actualizaciones durante el arrastre
        });
        
        // Evento change: se dispara cuando se suelta el control deslizante
        yearSlider.addEventListener('change', function() {
            console.log(`Year slider value changed to: ${this.value}`);
            currentSelectedYear = parseInt(this.value, 10);
            applyFilters(); // Aplicamos el filtro cuando se suelta el control
        });
        
        // Evento mousedown: podemos añadir efectos visuales al iniciar el arrastre
        yearSlider.addEventListener('mousedown', function() {
            yearDisplay.style.color = '#FF5722'; // Cambia el color durante el ajuste
        });
        
        // Evento mouseup: restauramos los efectos visuales al soltar
        yearSlider.addEventListener('mouseup', function() {
            yearDisplay.style.color = '#4CAF50'; // Restaura el color original
        });
    }
    
    // Domain filter event listener
    const domainFilter = document.getElementById('domain-filter');
    if (domainFilter) {
        domainFilter.addEventListener('change', function(event) {
            console.log(`Domain filter changed to: ${event.target.value || "All Domains"}`);
            currentSelectedDomain = event.target.value;
            applyFilters();
        });
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

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed.");
    loadData();
});

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