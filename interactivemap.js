(function () {
    var DEBUG = false,
        SENTRY_VISION_RADIUS = 850,
        OBSERVER_VISION_RADIUS = 1600,
        TOWER_DAY_VISION_RADIUS = 1800,
        TOWER_NIGHT_VISION_RADIUS = 800,
        TOWER_TRUE_SIGHT_RADIUS = 900,
        TOWER_ATTACK_RANGE_RADIUS = 700,
        map_data_path = "data.json",
        map_tile_path = "tiles/",
        ward_icon_path = "ward_observer.png",
        sentry_icon_path = "ward_sentry.png",
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
        dayRangeLayer = new OpenLayers.Layer.Vector("Day Vision Range"),
        nightRangeLayer = new OpenLayers.Layer.Vector("Night Vision Range"),
        trueSightRangeLayer = new OpenLayers.Layer.Vector("True Sight Range"),
        attackRangeLayer = new OpenLayers.Layer.Vector("Attack Range"),
        polygonLayer = new OpenLayers.Layer.Vector("Drawn Circles"),
        wardVisionLayer = new OpenLayers.Layer.Vector("Ward Vision"),
        visionSimulationLayer = new OpenLayers.Layer.Vector("Vision Simulation"),
        iconLayer = new OpenLayers.Layer.Markers("Placed Wards"),
        renderer = OpenLayers.Util.getParameters(window.location.href).renderer,
        drawControls,
        lastDistance,
        style = {
            lightblue: {
                strokeColor: "#007FFF",
                strokeOpacity: 1,
                strokeWidth: 1,
                fillColor: "#007FFF",
                fillOpacity: .4
            },
            red: {
                strokeColor: "#FF0000",
                strokeOpacity: 1,
                strokeWidth: 1,
                fillColor: "#FF0000",
                fillOpacity: .4
            },
            green: {
                strokeColor: "#00FF00",
                strokeOpacity: 1,
                strokeWidth: 1,
                fillColor: "#00FF00",
                fillOpacity: .4
            },
            yellow: {
                strokeColor: "#FFFF00",
                strokeOpacity: 1,
                strokeWidth: 1,
                fillColor: "#FFFF00",
                fillOpacity: .4
            }
        },
        jstsToOpenLayersParser = new jsts.io.OpenLayersParser(),
        geometryFactory = new jsts.geom.GeometryFactory(),
        CELL = [1, 1],
        SIZE = [256, 248],
        COLOR_WALL = [40, 40, 40],
        COLOR_FLOOR = [160, 160, 160],
        COLOR_LIGHT = [255, 255, 0],
        COLOR_STUMP = [102, 51, 0],
        COLOR_LIT_STUMP = [167, 173, 47],
        RADIUS = parseInt(Math.floor(OBSERVER_VISION_RADIUS / 64)),
        ctx = document.getElementById("canvas").getContext("2d"),
        canvas = document.getElementById("elevation-canvas"),
        elevationCtx = canvas.getContext("2d"),
        walls = {},
        lights = {},
        tree_relations,
        trees,
        tree_blocks = {},
        invalid_blocks = {},
        tree_elevations = {
            "high": {},
            "middle": {},
            "low": {},
            "uber": {}
        },
        elevations,
        elevationImg = new Image();

/***********************************
 * COORDINATE CONVERSION FUNCTIONS *
 ***********************************/
     
    function lerp(minVal, maxVal, pos_r) {
        return pos_r * (maxVal - minVal) + minVal;
    }

    function reverseLerp(minVal, maxVal, pos) {
        return (pos - minVal) / (maxVal - minVal);
    }

    function latLonToWorld(x, y) {
        var x_r = lerp(map_x_boundaries[0], map_x_boundaries[1], x / map_w),
            y_r = lerp(map_y_boundaries[0], map_y_boundaries[1], (5120 - y) / map_h);
            
        return {x: x_r, y: y_r};
    }

    function worldToLatLon(x_r,y_r) {
        //var map_w = 5120, map_h = 4766,
            //map_x_boundaries = [-8200, 8200]
            //map_y_boundaries = [7558, -7678]
        var x = parseInt(reverseLerp(map_x_boundaries[0], map_x_boundaries[1], x_r) * map_w),
            y = parseInt(reverseLerp(map_y_boundaries[0], map_y_boundaries[1], y_r) * map_h);
            
        return {x: x, y: y};
    }

    function worldToGNVCoordinates(x1, y1) {
        return { x: Math.floor(x1/64 + 128), y: Math.floor(247-(y1/64 + 119))};
    }

    function gnvToWorldCoordinates(x1, y1) {
        return { x: parseInt((x1 - 128) * 64), y: parseInt(((247-y1) - 119) * 64)};
    }

    function getScaledRadius(r) {
        return r / (map_x_boundaries[1] - map_x_boundaries[0]) * map_w
    };

    function calculateDistance(order, units, measure) {
        if (order == 1) {
            if (units == "km") {
                return measure * 3214.07509338;
            }
            else {
                return measure * 3.21407509338;
            }
        }
        else {
            return measure * 3.21407509338;
        }
    }

/********************
 * CONTROL HANDLERS *
 ********************/

    function handleTowerMarkerClick(e) {
        var circle,
            feature,
            center;
            
        if (!e.object.showInfo) {
            center = new OpenLayers.Geometry.Point(e.object.lonlat.lon, e.object.lonlat.lat);
            
            // day vision circle
            circle = OpenLayers.Geometry.Polygon.createRegularPolygon(center, getScaledRadius(e.object.day_vision_radius), 30);
            feature = new OpenLayers.Feature.Vector(circle);
            dayRangeLayer.addFeatures(feature);
            e.object.day_vision_feature = feature;
            
            // true sight circle
            circle = OpenLayers.Geometry.Polygon.createRegularPolygon(center, getScaledRadius(e.object.true_sight_radius), 30);
            feature = new OpenLayers.Feature.Vector(circle, null, style.lightblue);
            trueSightRangeLayer.addFeatures(feature);
            e.object.true_sight_feature = feature;
            
            // night vision circle
            circle = OpenLayers.Geometry.Polygon.createRegularPolygon(center, getScaledRadius(e.object.night_vision_radius), 30);
            feature = new OpenLayers.Feature.Vector(circle);
            nightRangeLayer.addFeatures(feature);
            e.object.night_vision_feature = feature;
            
            // attack range circle
            circle = OpenLayers.Geometry.Polygon.createRegularPolygon(center, getScaledRadius(e.object.attack_range_radius), 30);
            feature = new OpenLayers.Feature.Vector(circle, null, style.red);
            attackRangeLayer.addFeatures(feature);
            e.object.attack_range_feature = feature;
        }
        else {
            dayRangeLayer.removeFeatures(e.object.day_vision_feature);
            nightRangeLayer.removeFeatures(e.object.night_vision_feature);
            trueSightRangeLayer.removeFeatures(e.object.true_sight_feature);
            attackRangeLayer.removeFeatures(e.object.attack_range_feature);
        }
        e.object.showInfo = !e.object.showInfo;
    };

    function handleObserverClick(event) {
        var marker = createWardMarker(ward_icon_path, event.xy),
            circle = OpenLayers.Geometry.Polygon.createRegularPolygon(new OpenLayers.Geometry.Point(marker.lonlat.lon, marker.lonlat.lat), getScaledRadius(OBSERVER_VISION_RADIUS), 40),
            feature = new OpenLayers.Feature.Vector(circle),
            latlon = map.getLonLatFromPixel(event.xy);
            
        iconLayer.addMarker(marker);
        wardVisionLayer.addFeatures(feature);
        marker.radius_feature = feature;
        marker.events.register("mousedown", this, wardMarkerRemove);
        
        // run vision simulation
        updateVisibility(latlon, marker);
    }

    function handleSentryClick(event) {
        var marker = createWardMarker(sentry_icon_path, event.xy),
            circle = OpenLayers.Geometry.Polygon.createRegularPolygon(new OpenLayers.Geometry.Point(marker.lonlat.lon, marker.lonlat.lat), getScaledRadius(SENTRY_VISION_RADIUS), 30),
            feature = new OpenLayers.Feature.Vector(circle, null, style.lightblue);
            
        iconLayer.addMarker(marker);
        wardVisionLayer.addFeatures(feature);
        marker.radius_feature = feature;
        marker.events.register("mousedown", this, wardMarkerRemove);
    }

    function wardMarkerRemove(event) {
        if (event.object.radius_feature) wardVisionLayer.removeFeatures(event.object.radius_feature);
        if (event.object.vision_feature) visionSimulationLayer.removeFeatures(event.object.vision_feature);
        if (event.object.vision_center_feature) visionSimulationLayer.removeFeatures(event.object.vision_center_feature);
        iconLayer.removeMarker(event.object);
        OpenLayers.Event.stop(event);
    }

    function handleOnClick(event) {
        console.log('handleOnClick');
    }

    function handleMeasurements(event) {
        var out = "";
        
        if (event.order == 1) {
            out += "Distance: " + calculateDistance(event.order, event.units, event.measure).toFixed(0) + " units";
        }
        else {
            out += "Distance: " + calculateDistance(event.order, event.units, event.measure).toFixed(0) + " units<sup>2</" + "sup>";
        }
        document.getElementById("output").innerHTML = out;
        
        lastDistance = calculateDistance(event.order, event.units, event.measure);
        document.getElementById("traveltime").innerHTML = (lastDistance / document.getElementById("movespeed").value).toFixed(2);
        
        document.getElementById("traveltime-container").style.display = '';
    }

    function handleCircleMeasurements(event) {
        var element = document.getElementById("output"),
            out = "";
            
        if (event.order == 1) {
            out += "Radius: " + calculateDistance(event.order, event.units, event.measure).toFixed(0) + " units";
        }
        else {
            out += "Distance: " + calculateDistance(event.order, event.units, event.measure).toFixed(0) + " units<sup>2</" + "sup>";
        }
        element.innerHTML = out;
    }

    function handleCircleMeasurementsPartial(event) {
        var element = document.getElementById("output"),
            out = "",
            circle,
            feature,
            self = this;
            
        drawControls["select"].deactivate();
        if (event.order == 1) {
            if (event.measure > 0) {
                if (event.units == "km") {
                    circle = OpenLayers.Geometry.Polygon.createRegularPolygon(new OpenLayers.Geometry.Point(event.geometry.components[0].x, event.geometry.components[0].y), event.measure * 1e3, 30);
                }
                else {
                    circle = OpenLayers.Geometry.Polygon.createRegularPolygon(new OpenLayers.Geometry.Point(event.geometry.components[0].x, event.geometry.components[0].y), event.measure, 30);
                }
                feature = new OpenLayers.Feature.Vector(circle);
                polygonLayer.removeFeatures(event.geometry.circle_features);
                if ("circle_features" in event.geometry) {
                    event.geometry.circle_features.length = 0;
                    event.geometry.circle_features.push(feature);
                }
                else {
                    event.geometry.circle_features = [feature];
                }
                feature.measure_control = this;
                feature.is_measuring = true;
                polygonLayer.addFeatures(feature);
                if (event.geometry.components.length > 2) {
                    setTimeout(function () {
                        feature.is_measuring = false;
                        drawControls["select"].activate();
                        self.cancel();
                    }, 0);
                }
            }
            out += "Radius: " + calculateDistance(event.order, event.units, event.measure).toFixed(0) + " units";
        }
        else {
            out += "Distance: " + calculateDistance(event.order, event.units, event.measure).toFixed(0) + " units<sup>2</" + "sup>";
        }
        element.innerHTML = out;
    }

    function handleTreeMarkerClick(event) {
        var worldXY = latLonToWorld(event.object.lonlat.lon, event.object.lonlat.lat),
            gnvXY = worldToGNVCoordinates(worldXY.x, worldXY.y);
            
        event.object.treeVisible = !event.object.treeVisible
        event.object.setOpacity(event.object.treeVisible ? 1 : .4);
        toggleTree(gnvXY.x, gnvXY.y)
    }

    function toggleControl() {
        var control;
        
        for (var key in drawControls) {
            control = drawControls[key];
            if (this.value == key && this.checked) {
                control.activate();
            }
            else {
                control.deactivate();
            }
            if ((this.value == "polygonControl" || this.value == "circle") && this.checked) {
                drawControls["select"].activate();
            }
            else {
                drawControls["select"].deactivate();
            }
        }
        document.getElementById("output").innerHTML = "";
        
        document.getElementById("traveltime-container").style.display = 'none';
    };

    function addMarker(markers, ll, popupClass, popupContentHTML, closeBox, overflow) {
        var feature = new OpenLayers.Feature(markers, ll),
            marker;
            
        feature.closeBox = closeBox;
        feature.popupClass = popupClass;
        feature.data.popupContentHTML = popupContentHTML;
        feature.data.overflow = overflow ? "auto" : "hidden";
        marker = feature.createMarker();
        
        function handleHoverPopup(event) {
            if (this.popup == null) {
                this.popup = this.createPopup(this.closeBox);
                map.addPopup(this.popup);
                this.popup.show();
            }
            else {
                this.popup.toggle();
            }
            currentPopup = this.popup;
            OpenLayers.Event.stop(event);
        };
        
        if (markers.name == "Towers" || markers.name == "Trees") {
            marker.events.register("mouseover", feature, handleHoverPopup);
            marker.events.register("mouseout", feature, handleHoverPopup);
        }
        markers.addMarker(marker);
        return marker;
    }

    function createWardMarker(img, xy) {
        var size = new OpenLayers.Size(21, 25),
            offset = new OpenLayers.Pixel(-(size.w / 2), -size.h),
            icon = new OpenLayers.Icon(img, size, offset),
            latlon = map.getLonLatFromPixel(xy),
            marker = new OpenLayers.Marker(latlon, icon);
            
        return marker;
    }

    // Creates a 64x64 rectangle feature with c as top left corner
    function createTileFeature(c, style) {
        var r1 = worldToLatLon(c.x, c.y),
            r2 = worldToLatLon(c.x + 64, c.y),
            r3 = worldToLatLon(c.x + 64, c.y - 64),
            r4 = worldToLatLon(c.x, c.y - 64),
            box_points = [
                new OpenLayers.Geometry.Point(r1.x, 5120 - r1.y),
                new OpenLayers.Geometry.Point(r2.x, 5120 - r2.y),
                new OpenLayers.Geometry.Point(r3.x, 5120 - r3.y),
                new OpenLayers.Geometry.Point(r4.x, 5120 - r4.y)
            ],
            box_rect = new OpenLayers.Geometry.LinearRing(box_points),
            box_feature = new OpenLayers.Feature.Vector(box_rect, null, style);
            
        return box_feature;
    }

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

    function onMapDataLoad(data) {
        var markers = {},
            marker,
            vectorLayer = map.getLayersByName("Placed Wards")[0],
            box_points = [], box_rect, box_feature;

        for (var k in data) {
            // Create markers for non-neutral spawn box and non-tree layers
            if (k != "trigger_multiple" && k != "ent_dota_tree") {
                markers[k] = new OpenLayers.Layer.Markers(layerNames[k]);
                map.addLayer(markers[k]);
                markers[k].setVisibility(false);
                for (var i = 0; i < data[k].length; i++) {
                    marker = addMarker(markers[k], new OpenLayers.LonLat(data[k][i][0], 5120 - data[k][i][1]), OpenLayers.Popup.FramedCloud, "Click to toggle range overlay", false);
                    marker.day_vision_radius = TOWER_DAY_VISION_RADIUS;
                    marker.night_vision_radius = TOWER_NIGHT_VISION_RADIUS;
                    marker.true_sight_radius = TOWER_TRUE_SIGHT_RADIUS;
                    marker.attack_range_radius = TOWER_ATTACK_RANGE_RADIUS;
                    marker.showInfo = false;
                    if (k == "npc_dota_tower") {
                        marker.events.register("mousedown", markers[k], handleTowerMarkerClick);
                    }
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
                    box_feature = new OpenLayers.Feature.Vector(box_rect, null, style.green);
                    markers["npc_dota_neutral_spawner_box"].addFeatures([box_feature]);
                }
            }
        }
        
        map.raiseLayer(vectorLayer, map.layers.length);
        
        // Create tree markers the first time the tree layer is switched to
        map.events.register("changelayer", null, function (event) {
            if (event.property === "visibility" && event.layer.name == layerNames["ent_dota_tree"] && !event.layer.loaded) {
                for (var i = 0; i < event.layer.data.length; i++) {
                    marker = addMarker(event.layer, new OpenLayers.LonLat(event.layer.data[i][0], 5120 - event.layer.data[i][1]), OpenLayers.Popup.FramedCloud, "Click to toggle on/off.<br>Affects placed wards vision simulation.", false);
                    marker.treeVisible = true;
                    marker.events.register("mousedown", event.layer, handleTreeMarkerClick);
                }
                event.layer.loaded = !event.layer.loaded;
            }
        })
    }
    
    function getJSON(path, callback) {
        var request = new XMLHttpRequest();
        
        request.open('GET', path, true);
        request.onload = function () {
            if (request.status >= 200 && request.status < 400) {
                var data = JSON.parse(request.responseText);
                callback(data);
            }
            else {
                alert('Error loading page.');
            }
        };
        request.onerror = function () {
            alert('Error loading page.');
        };
        request.send();
        return request;
    }

/*******************************
 * VISION SIMULATION FUNCTIONS *
 *******************************/
 
    // Gets elevation of an x,y coordinate from the elevation image
    function getElevation(x, y) {
        var key = x+","+y,
            imgd = elevationCtx.getImageData(x, y, 1, 1),
            pix = imgd.data;
            
        if (pix[0] == 0 && pix[1] == 0 && pix[2] == 0) {
            return "invalid"
        }
        if (pix[0] == 255 && pix[1] == 0 && pix[2] == 0) {
            return "high"
        }
        if (pix[0] == 0 && pix[1] == 255 && pix[2] == 0) {
            return "low"
        }
        if (pix[0] == 0 && pix[1] == 0 && pix[2] == 255) {
            return "middle"
        }
        if (pix[0] == 255 && pix[1] == 255 && pix[2] == 0) {
            return "uber"
        }
        console.log(x, y, pix);
    }
    
    function addTreeWalls(walls, elevation) {
        for (key in tree_elevations[elevation]) {
            if (tree_blocks[key]) walls[key] = 1;
        }
    }

    function updateVisibility(latlon, marker) {
        var worldXY = latLonToWorld(latlon.lon, latlon.lat),
            gnvXY = worldToGNVCoordinates(worldXY.x, worldXY.y),
            x = gnvXY.x,
            y = gnvXY.y,
            elevation = getElevation(x, y),
            key = x+","+y,
            box_feature,
            fov = new ROT.FOV.PreciseShadowcasting(lightPassesCallback, {topology:8}),
            lightPoints = [],
            union = null,
            visionFeature;
        
        // create and add center marker polygon
        box_feature = createTileFeature(gnvToWorldCoordinates(gnvXY.x, gnvXY.y), (elevation == "invalid" || tree_blocks[key]) ? style.red : style.green);
        visionSimulationLayer.addFeatures([box_feature]);
        marker.vision_center_feature = box_feature;
        
        // set walls based on elevation
        if (elevation == "invalid" || tree_blocks[key]) {
            console.log('invalid');
            walls = {};
            setWalls(walls, tree_blocks);
            redraw();
            return
        }
        else {
            walls = {};
            setWalls(walls, elevations[elevation]);
            addTreeWalls(walls, elevation);
        }
        
        // get light points from shadowcasting
        lights = {};
        fov.compute(x, y, RADIUS, function(x2, y2, r, vis) {
            var key = x2+","+y2;
            if (vis == 1 && (!tree_blocks[key] || !tree_elevations[elevation][key]) && (x-x2)*(x-x2) + (y-y2)*(y-y2) <= RADIUS * RADIUS) {
                lights[key] = 255;
                lightPoints.push(gnvToWorldCoordinates(x2, y2));
            }
        });

        // merge light points into a single polygon
        for (var i = 0; i < lightPoints.length; i++) {
            var c = lightPoints[i],
                r1 = worldToLatLon(c.x, c.y),
                r2 = worldToLatLon(c.x + 64, c.y),
                r3 = worldToLatLon(c.x + 64, c.y - 64),
                r4 = worldToLatLon(c.x, c.y - 64),
                shell = geometryFactory.createLinearRing([
                    new jsts.geom.Coordinate(r1.x, 5120 - r1.y),
                    new jsts.geom.Coordinate(r2.x, 5120 - r2.y),
                    new jsts.geom.Coordinate(r3.x, 5120 - r3.y),
                    new jsts.geom.Coordinate(r4.x, 5120 - r4.y),
                    new jsts.geom.Coordinate(r1.x, 5120 - r1.y)
                ]),
                jstsPolygon = geometryFactory.createPolygon(shell);
                
            if (union == null) {
                union = jstsPolygon;
            }
            else {
                union = union.union(jstsPolygon);
            }
        }
        
        // add vision polygon to map
        union = jstsToOpenLayersParser.write(union);
        visionFeature = new OpenLayers.Feature.Vector(union, null, style.yellow);
        visionSimulationLayer.addFeatures([visionFeature]);
        marker.vision_feature = visionFeature;

        redraw();
    }

    function lightPassesCallback(x, y) {
        return (!(x+","+y in walls));
    }

    function setWalls(obj, index) {
        for (var i =0; i < index.length; i++) {
            obj[index[i][0]+","+index[i][1]] = 1;
        }
    }
    
    function toggleTree(x, y) {
        var key = x+","+y;
        
        if (tree_relations[key]) {
            for (var i = 0; i < tree_relations[key].length; i++) {
                if (tree_blocks[tree_relations[key][i]]) {
                    delete tree_blocks[tree_relations[key][i]];
                }
                else {
                    tree_blocks[tree_relations[key][i]] = 1;
                }
            }
        }
    }

    function onVisionDataLoad(data) {
        tree_relations = data.tree_relations;
        trees = data.trees;
        elevations = data.elevations;
        setWalls(tree_blocks, trees);
        setWalls(invalid_blocks, elevations.invalid);
        setWalls(tree_elevations.high, data.tree_elevations.high);
        setWalls(tree_elevations.middle, data.tree_elevations.middle);
        setWalls(tree_elevations.low, data.tree_elevations.low);
        setWalls(tree_elevations.uber, data.tree_elevations.uber);
    }

    function redraw() {
        if (!DEBUG) return;

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = "rgb("+COLOR_FLOOR.join(",")+")";
        ctx.fillRect(0,0, CELL[0]*SIZE[0], CELL[1]*SIZE[1]);
        for (var x=0;x<SIZE[0];x++) {
            for (var y=0;y<SIZE[1];y++) {
                var key = x+","+y,
                    light = lights[key],
                    c = [];
                    
                if (light) {
                    c = COLOR_LIGHT;
                    if (tree_relations[key] && !tree_blocks[key]) {
                        c = COLOR_LIT_STUMP;
                    }
                    ctx.fillStyle = "rgb("+c.join(",")+")";
                    ctx.fillRect(x*CELL[0], y*CELL[1], CELL[0], CELL[1]);
                }
                else if (!light && tree_relations[key]) {
                    c = tree_blocks[key] ? [0,255,0] : COLOR_STUMP;
                    ctx.fillStyle = "rgb("+c.join(",")+")";
                    ctx.fillRect(x*CELL[0], y*CELL[1], CELL[0], CELL[1]);
                }
                else if (!light && invalid_blocks[key]) {
                    c = COLOR_WALL;
                    ctx.fillStyle = "rgb("+c.join(",")+")";
                    ctx.fillRect(x*CELL[0], y*CELL[1], CELL[0], CELL[1]);
                }
            }
        }
    }

/********************
 * INITITIALIZATION *
 ********************/
 
    // Start setting up the map, adding controls and layers
    map.addLayer(wms);
    map.zoomToMaxExtent();
    map.addControl(layerSwitcher);
    layerSwitcher.maximizeControl();
    map.addLayer(dayRangeLayer);
    map.addLayer(nightRangeLayer);
    map.addLayer(trueSightRangeLayer);
    map.addLayer(attackRangeLayer);
    map.addLayer(polygonLayer);
    map.addLayer(wardVisionLayer);
    map.addLayer(visionSimulationLayer);
    map.addLayer(iconLayer);

    // i don't remember what this is for...
    OpenLayers.Control.Click = OpenLayers.Class(OpenLayers.Control, {
        defaultHandlerOptions: {
            single: true,
            "double": false,
            pixelTolerance: 0,
            stopSingle: false,
            stopDouble: false
        },
        initialize: function (options) {
            this.handlerOptions = OpenLayers.Util.extend({}, this.defaultHandlerOptions);
            OpenLayers.Control.prototype.initialize.apply(this, arguments);
            this.handler = new OpenLayers.Handler.Click(this, {
                click: this.onClick,
                dblclick: this.onDblclick
            }, this.handlerOptions);
        },
        onClick: handleOnClick,
        onDblclick: function (event) {
            var output = document.getElementById(this.key + "Output"),
                msg = "dblclick " + event.xy;
            output.value = output.value + msg + "\n";
        }
    });

    // Controls configuration
    renderer = renderer ? [renderer] : OpenLayers.Layer.Vector.prototype.renderers;
    drawControls = {
        line: new OpenLayers.Control.Measure(OpenLayers.Handler.Path, {
            persist: true,
            immediate: true,
            handlerOptions: {
                layerOptions: {
                    renderers: renderer
                }
            }
        }),
        circle: new OpenLayers.Control.Measure(OpenLayers.Handler.Path, {
            persist: false,
            immediate: true,
            handlerOptions: {
                layerOptions: {
                    renderers: renderer
                }
            }
        }),
        observerclick: new OpenLayers.Control.Click({
            onClick: handleObserverClick,
            handlerOptions: {
                single: true
            }
        }),
        sentryclick: new OpenLayers.Control.Click({
            onClick: handleSentryClick,
            handlerOptions: {
                single: true
            }
        }),
        polygonControl: new OpenLayers.Control.DrawFeature(polygonLayer, OpenLayers.Handler.RegularPolygon, {
            handlerOptions: {
                sides: 30
            }
        }),
        select: new OpenLayers.Control.SelectFeature(polygonLayer, {
            hover: true,
            highlightOnly: false,
            callbacks: {
                click: function (feature) {
                    var element = document.getElementById("output");
                    if (feature.measure_control && feature.is_measuring) {
                        feature.measure_control.cancel();
                        feature.is_measuring = false;
                        this.highlight(feature);
                    }
                    else {
                        element.innerHTML = "";
                        polygonLayer.removeFeatures(feature);
                    }
                }
            },
            overFeature: function (feature) {
                var element = document.getElementById("output"),
                    out = "Radius: " + (.565352 * Math.sqrt(feature.geometry.getArea()) * 3.21407509338).toFixed(0) + " units";
                element.innerHTML = out;
                this.highlight(feature);
            },
            outFeature: function (feature) {
                var element = document.getElementById("output");
                element.innerHTML = "";
                this.unhighlight(feature)
            }
        })
    };

    // Add controls to map
    for (var key in drawControls) {
        if (key == "line") {
            drawControls[key].events.on({
                measure: handleMeasurements,
                measurepartial: handleMeasurements
            })
        }
        if (key == "circle") {
            drawControls[key].events.on({
                measure: handleCircleMeasurements,
                measurepartial: handleCircleMeasurementsPartial
            })
        }
        map.addControl(drawControls[key]);
    }

    // X/Y coordinate update display handler
    map.events.register("mousemove", map, function (e) {
        var position = this.events.getMousePosition(e),
            lonlat = map.getLonLatFromPixel(e.xy),
            worldXY = latLonToWorld(lonlat.lon, lonlat.lat),
            gnvXY,
            key,
            elevation,
            box_feature;
            
        position.x = worldXY.x.toFixed(0);
        position.y = worldXY.y.toFixed(0);
        OpenLayers.Util.getElement("coords").innerHTML = position;
        
        if (visionSimulationLayer.cursor_marker) {
            visionSimulationLayer.removeFeatures(visionSimulationLayer.cursor_marker);
        }
        
        if (document.getElementById("observerToggle").checked) {
            gnvXY = worldToGNVCoordinates(worldXY.x, worldXY.y);
            key = gnvXY.x+","+gnvXY.y;
            elevation = getElevation(gnvXY.x, gnvXY.y);
            box_feature = createTileFeature(gnvToWorldCoordinates(gnvXY.x, gnvXY.y), (elevation == "invalid" || tree_blocks[key]) ? style.red : style.green);
            visionSimulationLayer.addFeatures([box_feature]);
            visionSimulationLayer.cursor_marker = box_feature;
        }
    });
    
    // Show/hide controls panel
    document.getElementById("controls-max").addEventListener("click", function (e){
        document.getElementById("controls-list").style.display = '';
        document.getElementById("output-panel").style.display = '';
        document.getElementById("controls-min").style.display = 'block';
        this.style.display = 'none';
    }, false);
    document.getElementById("controls-min").addEventListener("click", function (e){
        document.getElementById("controls-list").style.display = 'none';
        document.getElementById("output-panel").style.display = 'none';
        document.getElementById("controls-max").style.display = 'block';
        this.style.display = 'none';
    }, false);

    // Show/hide X/Y coordinate display
    document.getElementById("coordControl").addEventListener("change", function (e){
        if (this.checked) {
            document.getElementById("coords").style.display = 'block';
        }
        else {
            document.getElementById("coords").style.display = 'none';
        }
    }, false);

    // Update travel time display when movespeed input changes
    document.getElementById("movespeed").addEventListener("change", function (e){
        document.getElementById("traveltime").innerHTML = (lastDistance / document.getElementById("movespeed").value).toFixed(2);
    }, false);

    // Set up panel radio button toggle handlers
    document.getElementById('noneToggle').addEventListener('click', toggleControl, false);
    document.getElementById('lineToggle').addEventListener('click', toggleControl, false);
    document.getElementById('circleToggle').addEventListener('click', toggleControl, false);
    document.getElementById('observerToggle').addEventListener('click', toggleControl, false);
    document.getElementById('sentryToggle').addEventListener('click', toggleControl, false);

    getJSON(map_data_path, onMapDataLoad);    
    getJSON('vision.json', onVisionDataLoad);
    
    ctx.canvas.width = CELL[0]*SIZE[0];
    ctx.canvas.height = CELL[1]*SIZE[1];
    ctx.fillStyle = "black";
    elevationImg.src = 'elevation.png';
    elevationImg.onload = function () {
        canvas.width = elevationImg.width;
        canvas.height = elevationImg.height;
        canvas.getContext('2d').drawImage(elevationImg, 0, 0, elevationImg.width, elevationImg.height);
    }
}());