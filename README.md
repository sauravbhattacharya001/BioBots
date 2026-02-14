# BioBots Tool

A simple tool for checking BioBot 1 print run statistics.

## Visual Studio

To run this project you will need Visual Studio 2015. You can download it from here: https://www.visualstudio.com/en-us/products/vs-2015-product-editions.aspx.

## JSON Settings

The controller reads print data from a JSON file. By default it looks for
`bioprint-data.json` in the application root. To use a custom path, add a
`DataFilePath` entry to the `<appSettings>` section of your `Web.config`:

```xml
<appSettings>
  <add key="DataFilePath" value="C:\path\to\your\bioprint-data.json" />
</appSettings>
```

## API Endpoints

All endpoints follow the pattern:

```
GET /api/prints/{metric}/{comparison}/{value}
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `serial` | int | BioBot 1 serial number |
| `deadPercent` | double | Percent of print determined dead via live/dead imaging |
| `livePercent` | double | Percent of print determined alive via live/dead imaging |
| `elasticity` | double | Structural rigidity measured in kPa |
| `cl_duration` | int | Photocrosslinking duration (ms) |
| `cl_intensity` | int | Photocrosslinking light intensity (%) |
| `extruder1` | double | Extruder 1 pressure at print time |
| `extruder2` | double | Extruder 2 pressure at print time |
| `layerHeight` | double | Height of each layer (mm) |
| `layerNum` | int | Number of layers |
| `wellplate` | int | Wellplate type |

### Comparison Operations

- **`greater`** — Count of records where metric > value
- **`lesser`** — Count of records where metric < value
- **`equal`** — Count of records where metric = value

### Aggregation Functions

Pass the function name as the value parameter (no comparison needed):

- **`Maximum`** — Maximum value across all records
- **`Minimum`** — Minimum value across all records
- **`Average`** — Average value across all records

### Examples

```
GET /api/prints/livePercent/greater/50      → Count of prints with >50% live cells
GET /api/prints/elasticity/lesser/100       → Count of prints with elasticity <100 kPa
GET /api/prints/layerNum/greater/Maximum    → Maximum layer count across all prints
```

## Product Snapshot

http://imgur.com/a/MR6ww

## Contact

Saurav Bhattacharya  
608-338-6101  
online.saurav@gmail.com
