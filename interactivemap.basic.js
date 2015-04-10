var map_data_path = "data.json",
    map_tile_path = "tiles/",
    map_w = 5120,
    map_h = 5120,
    map_x_boundaries = [-8200, 8200],
    map_y_boundaries = [7558, -8842],
    map = new OpenLayers.Map("map", {
        maxExtent: new OpenLayers.Bounds(0, 0, 5120, 5120),
        numZoomLevels: 3,
        maxResolution: 4,
        units: "m",
        projection: "EPSG:900913",
        displayProjection: new OpenLayers.Projection("EPSG:900913")
    }),
    layerNames = {
        npc_dota_roshan_spawner: "Roshan",
        dota_item_rune_spawner: "Runes",
        ent_dota_tree: "Trees",
        npc_dota_fort: "Ancients",
        ent_dota_shop: "Shops",
        npc_dota_tower: "Towers",
        npc_dota_barracks: "Barracks",
        npc_dota_building: "Buildings",
        trigger_multiple: "Neutral Camps Spawn Boxes",
        npc_dota_neutral_spawner: "Neutral Camps"
    },
    wms = new OpenLayers.Layer.TMS("Dota 2 Map", map_tile_path, {
        type: "png",
        getURL: getMyURL
    }),
    layerSwitcher = new OpenLayers.Control.LayerSwitcher({
        ascending: false
    }),
    request = new XMLHttpRequest();

function getMapCoordinates(x, y) {
    var x_r = lerp(map_x_boundaries[0], map_x_boundaries[1], x / map_w),
        y_r = lerp(map_y_boundaries[0], map_y_boundaries[1], y / map_h);
    return [x_r, y_r];
}

function lerp(minVal, maxVal, pos_r) {
    return pos_r * (maxVal - minVal) + minVal;
}

function addMarker(markers, ll) {
    var feature = new OpenLayers.Feature(markers, ll),
        marker;
    marker = feature.createMarker();
    markers.addMarker(marker);
    return marker;
}

function getScaledRadius(r) {
    return r / (map_x_boundaries[1] - map_x_boundaries[0]) * map_w
};

function getMyURL(bounds) {
    var res = this.map.getResolution(),
        x = Math.round((bounds.left - this.maxExtent.left) / (res * this.tileSize.w)),
        y = Math.round((this.maxExtent.top - bounds.top) / (res * this.tileSize.h)),
        z = map.getZoom(),
        path = z + "/tile_" + x + "_" + y + "." + this.type,
        url = this.url;
    if (url instanceof Array) {
        url = this.selectUrl(path, url)
    }
    return url + path
}

function onDataLoad(data) {
    var markers = {},
        marker,
        style = {
            strokeColor: "#00FF00",
            strokeOpacity: 1,
            strokeWidth: 1,
            fillColor: "#00FF00",
            fillOpacity: .4
        },
        box_points = [], box_rect, box_feature;

    for (var k in data) {
        // Create markers for non-neutral spawn box and non-tree layers
        if (k != "trigger_multiple" && k != "ent_dota_tree") {
            markers[k] = new OpenLayers.Layer.Markers(layerNames[k]);
            map.addLayer(markers[k]);
            markers[k].setVisibility(false);
            for (var i = 0; i < data[k].length; i++) {
                marker = addMarker(markers[k], new OpenLayers.LonLat(data[k][i][0], 5120 - data[k][i][1]));
            }
        }
        // Set up tree layer without creating tree markers yet
        else if (k == "ent_dota_tree") {
            markers[k] = new OpenLayers.Layer.Markers(layerNames[k]);
            map.addLayer(markers[k]);
            markers[k].setVisibility(false);
            markers[k].data = data[k];
        }
        // Create neutral spawn markers and rectangles
        else if (k == "trigger_multiple") {
            markers["npc_dota_neutral_spawner_box"] = new OpenLayers.Layer.Vector(layerNames[k]);
            map.addLayer(markers["npc_dota_neutral_spawner_box"]);
            markers["npc_dota_neutral_spawner_box"].setVisibility(false);
            for (var i = 0; i < data[k].length; i++) {
                box_points = [];
                for (var j = 0; j < data[k][i].length; j++) {
                    box_points.push(new OpenLayers.Geometry.Point(data[k][i][j][0], 5120 - data[k][i][j][1]));
                }
                box_rect = new OpenLayers.Geometry.LinearRing(box_points);
                box_feature = new OpenLayers.Feature.Vector(box_rect, null, style);
                markers["npc_dota_neutral_spawner_box"].addFeatures([box_feature]);
            }
        }
    }
    
    // Create tree markers the first time the tree layer is switched to
    map.events.register("changelayer", null, function (evt) {
        if (evt.property === "visibility" && evt.layer.name == layerNames["ent_dota_tree"] && !evt.layer.loaded) {
            for (var i = 0; i < evt.layer.data.length; i++) {
                marker = addMarker(evt.layer, new OpenLayers.LonLat(evt.layer.data[i][0], 5120 - evt.layer.data[i][1]));
            }
            evt.layer.loaded = !evt.layer.loaded;
        }
    })
}

// Start setting up the map, adding controls and layers
map.addLayer(wms);
map.zoomToMaxExtent();
map.addControl(layerSwitcher);
layerSwitcher.maximizeControl();

// X/Y coordinate update display handler
map.events.register("mousemove", map, function (e) {
    var position = this.events.getMousePosition(e),
        lonlat = map.getLonLatFromPixel(e.xy),
        xy = getMapCoordinates(lonlat.lon, 5120 - lonlat.lat);
    position.x = xy[0].toFixed(0);
    position.y = xy[1].toFixed(0);
    OpenLayers.Util.getElement("coords").innerHTML = position;
});

// Get map data
request.open('GET', map_data_path, true);
request.onload = function () {
    if (request.status >= 200 && request.status < 400) {
        var data = JSON.parse(request.responseText);
        onDataLoad(data);
    }
    else {
        alert('Error loading page.');
    }
};
request.onerror = function () {
    alert('Error loading page.');
};
request.send();
