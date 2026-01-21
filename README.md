# DataScraper Backend API

## Overview

This is a robust Node.js/Express backend service designed for high-performance data scraping from Google Maps via RapidAPI. It features advanced logic for handling large-scale data extraction, automatic location-based sorting, and intelligent rate limiting.

## Key Features

- **Google Maps Scraping**: Integrates with RapidAPI to fetch business details (Name, Address, Phone, Website, etc.).
- **Grid Search Strategy**: Automatically subdivides large search radii (>2km) into a coordinate grid to bypass the 60-result API limit, enabling deep scraping of extensive areas.
- **Smart Rate Limiting**: Implements a "Smart Retry" system with exponential backoff (waits 4s, 8s, 12s) to handle `429 Too Many Requests` errors gracefully without crashing.
- **Dynamic File Storage**: Automatically parses address components to save data in a structured hierarchy: `datascrapper/{Country}/{State}/{City}/`.
- **Data Merging**: Reads existing files before saving to deduplicate entries based on `place_id`, ensuring no data loss during incremental scrapes.

## Prerequisites

- **Node.js**: v16 or higher
- **NPM**: v8 or higher
- **RapidAPI Key**: A valid subscription to the Google Maps Places API on RapidAPI.

## Installation

1.  Clone the repository:

    ```bash
    git clone <repository-url>
    cd datascraper-backend
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

3.  Configure Environment Variables:
    Create a `.env` file in the root directory:
    ```env
    PORT=5000
    RAPIDAPI_KEY=your_rapidapi_key_here
    RAPIDAPI_HOST=google-maps-23.p.rapidapi.com
    ```

## Usage

### Development Mode

Runs the server with `nodemon` for hot-reloading.

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

## API Endpoints

### `POST /api/scraper/search-rapid`

Triggers the scraping process.

**Body:**

```json
{
  "category": "Garment Exporter",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "radius": 5000
}
```

- **radius**: If > 2000, triggers Grid Search.

## Logic Flow

1.  **Request**: Backend receives target coordinates and category.
2.  **Grid Generation**: If the area is large, it generates a grid of sub-points.
3.  **Scraping**: Iterates through points, respecting rate limits.
4.  **Processing**: Deduplicates results and parses address components.
5.  **Storage**: Saves unique businesses to `datascrapper/Country/State/City/filename.json` (and `.xlsx`).

## Troubleshooting

- **429 Errors**: The system handles these automatically. Check the console for "Rate Limit 429 hit. Retrying in..." messages.
- **No Results**: Verify your `RAPIDAPI_KEY` and ensure the coordinates are correct.
