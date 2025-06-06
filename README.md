# Scientific Publication Heatmap Visualization Tool

An interactive web application that visualizes the global geographic distribution of scientific publications from ArXiv using dynamic heatmaps and advanced clustering algorithms.

## Overview

This tool provides an intuitive way to explore and analyze scientific research patterns across the globe by mapping publication data from ArXiv. Users can filter publications by year and research domain to understand how scientific output varies geographically and temporally.

## Key Features

### 🗺️ Interactive Heatmap Visualization
- **Dynamic Heat Distribution**: Real-time heatmap generation showing publication density across geographic locations
- **Zoom-Adaptive Rendering**: Heatmap parameters (radius, blur, intensity) automatically adjust based on zoom level for optimal visualization
- **Gradient Color Mapping**: Blue-to-red gradient indicating publication density from low to high
- **Responsive Legend**: Bottom-left positioned legend showing density scale (0% to 100%)

### 🔍 Advanced Filtering System
- **Year Range Selection**: Interactive slider covering publications from 1991 to 2025
- **Domain-Based Filtering**: Filter by specific ArXiv categories (e.g., cs.AI, math.CO, physics.hep-ph)
- **Animation Mode**: Automatic year progression to visualize temporal changes in publication patterns
- **Real-time Updates**: Instant map updates when filters are applied

### 📊 Intelligent Clustering & Analysis
- **DBSCAN Clustering**: Identifies publication hotspots using density-based spatial clustering
- **Smoothed Cluster Boundaries**: Uses Turf.js for geometric operations creating organic, buffered cluster shapes (75km radius)
- **Hotspot Markers**: Interactive markers placed at cluster centroids showing detailed information
- **Publication Density Weighting**: Locations with higher publication counts receive proportionally higher heatmap intensity

### 📱 Responsive User Interface
- **Collapsible Controls**: Filter panel automatically collapses on mobile devices (<768px width)
- **Toggle Functionality**: Show/Hide button for filter controls and statistics
- **Statistics Panel**: Real-time display of current view metrics including:
  - Total publications count
  - Top countries by publication count
  - Top cities by publication count
  - Top institutions by publication count
  - Current time period display

### 🎯 Interactive Popups
- **Unified Popup System**: Consistent information display for both hotspot clicks and general map clicks
- **Contextual Information**: Shows relevant data for clicked location including:
  - Geographic area name (city/region)
  - Top publication categories
  - Top contributing cities
  - Top institutions
  - Sample publication titles
- **Smart Data Aggregation**: Automatically finds and groups nearby publications within specified radius

## Technical Implementation

### Core Technologies
- **[Leaflet.js](https://leafletjs.com/)**: Interactive mapping library providing base map functionality
- **[Leaflet.heat](https://github.com/Leaflet/Leaflet.heat)**: Heatmap plugin for smooth density visualization
- **[Turf.js](https://turfjs.org/)**: Geospatial analysis library for clustering and geometric operations
- **[PapaParse](https://www.papaparse.com/)**: High-performance CSV parser for data processing
- **Vanilla JavaScript**: Core application logic without external frameworks

### Architecture Components

#### Data Processing Pipeline
```javascript
// Data flow: CSV → Parsing → Filtering → Heatmap Generation
loadData() → processLoadedData() → applyFilters() → updateHeatmap()
```

#### Clustering Algorithm
1. **DBSCAN Application**: Groups nearby publications using configurable epsilon and minimum points
2. **Convex Hull Generation**: Creates base polygon around cluster points
3. **Buffer Application**: Applies 75km buffer to base shape for smooth boundaries
4. **Geometric Union**: Merges overlapping buffers into single polygons

#### Performance Optimizations
- **Efficient Data Structures**: Uses Sets for unique value tracking and Maps for fast lookups
- **Lazy Loading**: Data processing occurs only when needed
- **Memory Management**: Clears and rebuilds layer groups to prevent memory leaks
- **Zoom-Based Rendering**: Adjusts rendering parameters based on current zoom level

### Data Structure

The application processes CSV data with the following key fields:
- `latitude` / `longitude`: Geographic coordinates
- `publication_year`: Year of publication
- `arxiv_categories`: Space-separated ArXiv category codes
- `title`: Publication title
- `city_name`: Associated city
- `country_name`: Associated country
- `institution_name`: Publishing institution

## Installation & Usage

### Quick Start
1. **Clone the repository**:
   ```bash
   git clone [repository-url]
   cd mineria
   ```

2. **Set up a local server** (required for CSV loading):
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx http-server
   
   # Using PHP
   php -S localhost:8000
   ```

3. **Open in browser**:
   Navigate to `http://localhost:8000`

### Data Requirements
- Place CSV data file in the `data/` directory
- Ensure CSV contains required columns (latitude, longitude, publication_year, etc.)
- Current dataset: `arxiv_locations_combined.csv` (306MB with comprehensive ArXiv publication data)

### Configuration
Modify the following variables in `js/main.js` for customization:
- `initialCoords`: Map center coordinates
- `initialZoom`: Default zoom level
- `animationSpeed`: Animation interval (milliseconds)
- Heatmap parameters in `getHeatmapOptions()`

## User Guide

### Basic Navigation
- **Pan**: Click and drag to move around the map
- **Zoom**: Use mouse wheel or zoom controls
- **Reset View**: Double-click to return to initial position

### Using Filters
1. **Year Selection**: Drag the year slider to focus on specific time periods
2. **Domain Filtering**: Select from dropdown to show only specific research areas
3. **Animation**: Click "Play Animation" to automatically progress through years
4. **Mobile**: Use "Show/Hide Filters" button to access controls on small screens

### Understanding the Visualization
- **Heat Intensity**: Darker red areas indicate higher publication density
- **Cluster Markers**: Clickable hotspots showing aggregated information
- **Statistics Panel**: Real-time metrics for current view
- **Popup Information**: Click anywhere on the map for detailed local data

## Performance Characteristics

### Scalability
- **Data Capacity**: Successfully handles datasets with 500,000+ publications
- **Rendering Performance**: Optimized for smooth interaction even with large datasets
- **Memory Usage**: Efficient memory management prevents browser crashes
- **Response Time**: Filter operations typically complete within 300ms

### Browser Compatibility
- **Modern Browsers**: Chrome, Firefox, Safari, Edge (latest versions)
- **Mobile Support**: Responsive design works on tablets and smartphones
- **WebGL**: Utilizes hardware acceleration when available

## Development Features

### Debugging & Monitoring
- Console logging for development debugging
- Performance timing measurements with `console.time()`
- Error handling for malformed data
- Loading indicators for user feedback

### Extensibility
- Modular function design for easy feature addition
- Configurable clustering parameters
- Pluggable filter system
- Customizable visualization options

## Data Sources

This project processes scientific publication data from:
- **ArXiv**: Open-access repository of scholarly articles
- **Geographic Data**: City and country coordinate information
- **Institution Mapping**: Research institution location data

The visualization helps researchers, policymakers, and academics understand:
- Global research collaboration patterns
- Geographic concentration of scientific output
- Temporal evolution of research activities
- Domain-specific publication distributions

## Contributing

To extend or modify the tool:
1. Follow the modular JavaScript structure
2. Add new filter types in the `applyFilters()` function
3. Extend clustering algorithms in `clusterDataForHotspots()`
4. Customize visualization parameters in heatmap configuration
5. Test with different dataset sizes for performance validation

## License

This project is developed for research and educational purposes. Please cite appropriately when using for academic work. 
