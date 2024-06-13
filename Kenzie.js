const express = require('express');
const bodyParser = require('body-parser');
const NodeGeocoder = require('node-geocoder');
const haversine = require('haversine-distance');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

const geocoder = NodeGeocoder({
  provider: 'openstreetmap'
});

// Sample transport speeds in km/h
const SPEEDS = {
  walking: 5,
  bus: 40,
  vehicle: 60
};

// Function to geocode an address to latitude and longitude
async function geocodeAddress(address) {
  const res = await geocoder.geocode(address);
  return { lat: res[0].latitude, lon: res[0].longitude };
}

// Function to calculate distance matrix for given locations
function calculateDistanceMatrix(locations) {
  const n = locations.length;
  const distMatrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        distMatrix[i][j] = haversine(locations[i], locations[j]) / 1000; // Convert to km
      }
    }
  }
  return distMatrix;
}

// Nearest Neighbor TSP algorithm
function tspNearestNeighbor(distMatrix) {
  const n = distMatrix.length;
  const unvisited = Array.from({ length: n }, (_, i) => i);
  const route = [unvisited.shift()];
  while (unvisited.length) {
    const last = route[route.length - 1];
    const nextCity = unvisited.reduce((a, b) => (distMatrix[last][a] < distMatrix[last][b] ? a : b));
    route.push(nextCity);
    unvisited.splice(unvisited.indexOf(nextCity), 1);
  }
  return route;
}

// Ant Colony Optimization algorithm
function acoOptimize(distMatrix, nAnts = 50, nIterations = 100, decay = 0.95, alpha = 1, beta = 2) {
  const n = distMatrix.length;
  let pheromone = Array.from({ length: n }, () => Array(n).fill(1 / n));
  let shortestPath = null;
  let shortestDistance = Infinity;

  for (let iteration = 0; iteration < nIterations; iteration++) {
    const allPaths = [];
    for (let ant = 0; ant < nAnts; ant++) {
      const path = [Math.floor(Math.random() * n)];
      while (path.length < n) {
        const i = path[path.length - 1];
        const probabilities = distMatrix[i].map((_, j) => pheromone[i][j] * alpha * (1 / distMatrix[i][j]) * beta);
        const total = probabilities.reduce((a, b) => a + b, 0);
        const normalized = probabilities.map(p => p / total);
        const nextCity = normalized.findIndex(p => Math.random() < p);
        if (!path.includes(nextCity)) {
          path.push(nextCity);
        }
      }
      allPaths.push(path);
    }

    allPaths.forEach(path => {
      const distance = path.reduce((sum, current, i, arr) => sum + distMatrix[current][arr[(i + 1) % n]], 0);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        shortestPath = path;
      }
    });

    pheromone = pheromone.map(row => row.map(val => val * decay));
    allPaths.forEach(path => {
      const distance = path.reduce((sum, current, i, arr) => sum + distMatrix[current][arr[(i + 1) % n]], 0);
      path.forEach((current, i) => {
        pheromone[current][path[(i + 1) % n]] += 1 / distance;
      });
    });
  }

  return shortestPath;
}

// Combined TSP and ACO algorithm
function tspAndAco(locations) {
  if (locations.length < 2) {
    return locations;
  }

  const distMatrix = calculateDistanceMatrix(locations);
  const initialRoute = tspNearestNeighbor(distMatrix);
  const optimizedRoute = acoOptimize(distMatrix);
  return optimizedRoute;
}

// Calculate travel time based on distance and speed
function calculateTravelTime(distance, speed) {
  return distance / speed * 60; // time in minutes
}

app.post('/optimize', async (req, res) => {
  const { addresses, mode = 'vehicle' } = req.body;

  try {
    const locations = await Promise.all(addresses.map(geocodeAddress));
    const optimizedRoute = tspAndAco(locations);

    const totalDistance = optimizedRoute.reduce((sum, current, i, arr) => 
      sum + haversine(locations[current], locations[arr[(i + 1) % optimizedRoute.length]]) / 1000, 0); // Convert to km
    
    const totalTime = calculateTravelTime(totalDistance, SPEEDS[mode]);
    const timestamps = [];
    let currentTime = new Date();
    optimizedRoute.forEach((current, i, arr) => {
      const next = arr[(i + 1) % optimizedRoute.length];
      const distance = haversine(locations[current], locations[next]) / 1000; // Convert to km
      const travelTime = calculateTravelTime(distance, SPEEDS[mode]);
      currentTime = new Date(currentTime.getTime() + travelTime * 60 * 1000); // Convert minutes to ms
      timestamps.push(currentTime);
    });

    res.json({
      optimized_route: optimizedRoute.map(i => addresses[i]),
      total_distance_km: totalDistance,
      total_time_minutes: totalTime,
      timestamps: timestamps.map(time => time.toISOString())
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'An error occurred during optimization' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(Server running on port ${PORT});
});
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pick-up and Delivery Optimization</title>
</head>
<body>
  <h1>Pick-up and Delivery Optimization</h1>
  <form id="addressForm">
    <div>
      <label for="address1">Pick-up Address:</label>
      <input type="text" id="address1" name="address1" required>
    </div>
    <div>
      <label for="address2">Delivery Address:</label>
      <input type="text" id="address2" name="address2" required>
    </div>
    <div>
      <label for="mode">Mode of Transport:</label>
      <select id="mode" name="mode">
        <option value="walking">Walking</option>
        <option value="bus">Bus</option>
        <option value="vehicle">Vehicle</option>
      </select>
    </div>
    <button type="submit">Optimize Route</button>
  </form>
  <div id="result"></div>
  <script>
    document.getElementById('addressForm').addEventListener('submit', async function (event) {
      event.preventDefault();

      const address1 = document.getElementById('address1').value;
      const address2 = document.getElementById('address2').value;
      const mode = document.getElementById('mode').value;

      try {
        const response = await fetch('http://localhost:3000/optimize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ addresses: [address1, address2], mode })
        });

        if (!response.ok) {
          document.getElementById('result').innerHTML = <p>Error: ${response.statusText}</p>;
          return;
        }

        const result = await response.json();
        document.getElementById('result').innerHTML = `
          <h2>Optimized Route</h2>
          <p>Route: ${result.optimized_route.join(' -> ')}</p>
          <p>Total Distance: ${result.total_distance_k}</p>