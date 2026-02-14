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

## Product Snapshot

http://imgur.com/a/MR6ww

## Contact

Saurav Bhattacharya  
608-338-6101  
online.saurav@gmail.com
