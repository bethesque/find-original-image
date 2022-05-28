'use strict';

const fs = require('fs');
const glob = require('glob');
const path = require('path');
const moment = require('moment');
const exif = require('fast-exif');
const sharp = require('sharp');
const PNG = require('pngjs').PNG;
var jpeg = require('jpeg-js');
const pixelmatch = require('pixelmatch');


function getDateFromFilePath(imagePath) {
  let dasherizedImagePath = imagePath.replace(/_/g, '-');
  let pattern = /\d{4}\-\d\d\-\d\d/g;
  let match;
  let date = null;

  while (match = pattern.exec(dasherizedImagePath)) {
    date = match[0];
  }

  if(date) {
    return moment(date, "YYYY-MM-DD");
  } else {
    return null;
  }
}

function concatenate(resultConstructor, ...arrays) {
    let totalLength = 0;
    for (let arr of arrays) {
        totalLength += arr.length;
    }
    let result = new resultConstructor(totalLength);
    let offset = 0;
    for (let arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

function getKeyLinesFromImage(decodedImage) {
  const lineLength = decodedImage.width * 4
  const middleLineNumber = decodedImage.width / 2
  const middleLineStart = middleLineNumber * lineLength
  const middleLineEnd = (middleLineNumber + 1) * lineLength
  const firstLine = decodedImage.data.slice(0, lineLength)
  const middleLine = decodedImage.data.slice(middleLineStart, middleLineEnd)
  const lastLine = decodedImage.data.slice(decodedImage.data.size - lineLength, decodedImage.data.size)

  return decodedImage.data.slice(0, lineLength)
}

function compareImages(targetImageMetadata, testImageMetadata, handleMatchFound){

  //console.log("Comparing", targetImageMetadata.path, testImageMetadata.path)

  const numDiffPixels = pixelmatch(
    targetImageMetadata.fingerprint.data,
    testImageMetadata.fingerprint.data,
    null,
    targetImageMetadata.fingerprint.width,
    targetImageMetadata.fingerprint.height,
    {threshold: 0.2});

  if(numDiffPixels === 0 || (numDiffPixels / targetImageMetadata.fingerprint.length < 0.1)) {
    handleMatchFound(targetImageMetadata.path, testImageMetadata.path)
  }
}

function prioritiseImagesWithSimilarDates(targetImagePath, testImageMetadatas) {
  let targetImageDate = getDateFromFilePath(targetImagePath);
  if (targetImageDate === null) {
    return testImageMetadatas
  }
  let testImagePathsWithDateDiffs = [];

  testImageMetadatas.forEach(function(testImageMetadata, index){
    let dateDifference = Math.abs(targetImageDate.diff(testImageMetadata.dateTaken));

    if((MAX_DATE_DIFF === null || dateDifference < MAX_DATE_DIFF) && testImagePathsWithDateDiffs.length < 100) {
      testImagePathsWithDateDiffs.push({metadata: testImageMetadata, diff: dateDifference});
    }
  });

  let sorted = testImagePathsWithDateDiffs.sort(function(a, b){
    return a.diff - b.diff;
  });
  return sorted.map(obj => obj.metadata);
}

function createDir(dir) {
  !fs.existsSync(dir) && fs.mkdirSync(dir);
}

function copyFile(source, destination) {
  fs.writeFileSync(destination, fs.readFileSync(source));
}

function moveTargetImageToFoundDir(targetImagePath, foundTargetImageDir) {
  let targetImageDestination = path.join(foundTargetImageDir, path.basename(targetImagePath));
  fs.renameSync(targetImagePath, targetImageDestination);
}

function copyTestImageToSearchResultsDir(testImagePath, searchResultsDir){
  let testImageDestination = path.join(searchResultsDir, path.basename(testImagePath));
  copyFile(testImagePath, testImageDestination);
}

function createMatchFoundHandler(searchResults, foundTargetImageDir, searchResultsDir){
  return function(targetImagePath, testImagePath) {
    if(!searchResults[targetImagePath]) {
      searchResults[targetImagePath] = []
    }

    const searchResultsForTarget = searchResults[targetImagePath]

    searchResultsForTarget.push(testImagePath)

    console.log("MATCHED!", targetImagePath, "with", testImagePath);
    moveTargetImageToFoundDir(targetImagePath, foundTargetImageDir);
    copyTestImageToSearchResultsDir(testImagePath, searchResultsDir);
  };
}

function getTestImagePaths(searchDirs) {
  let testImagePaths = [];
  searchDirs.forEach(searchDir => {
    testImagePaths = testImagePaths.concat(glob.sync(searchDir + "/*.{jpg,jpeg,JPG,JPEG}", {}));
  });
  return testImagePaths;
}

function doSearch(targetImageMetadatas, testImageMetadatas, searchResults, handleMatchFound) {
  targetImageMetadatas.forEach(function(targetImageMetadata){
    const targetImagePath = targetImageMetadata.path
    console.log(`Searching for ${targetImagePath}`)
    let prioritisedImageMetadatas = prioritiseImagesWithSimilarDates(targetImagePath, testImageMetadatas);
    prioritisedImageMetadatas.forEach(testImageMetadatas => {
      if(!searchResults[targetImagePath]) {
        compareImages(targetImageMetadata, testImageMetadatas, handleMatchFound);
      }
    });
  });
}

function findOriginalImages(targetImagesDir, searchDirs, searchResultsDir) {
  let searchResults = {};
  let foundTargetImageDir = path.join(targetImagesDir, 'found');
  createDir(foundTargetImageDir);
  createDir(searchResultsDir);
  let handleMatchFound = createMatchFoundHandler(searchResults, foundTargetImageDir, searchResultsDir);

  let targetImagePaths = glob.sync(targetImagesDir + '/*.{jpg,jpeg,JPG,JPEG}', {});
  let targetImageMetadatasPromises = extractMetadataForImages(targetImagePaths)
  let testImagePaths = getTestImagePaths(searchDirs);
  let testImageMetadataPromises = extractMetadataForImages(testImagePaths);

  Promise.all([targetImageMetadatasPromises, testImageMetadataPromises])
    .then(([targetImageMetadatas, testImageMetadatas]) => {
      doSearch(targetImageMetadatas, testImageMetadatas, searchResults, handleMatchFound);
      console.log(searchResults);
    }).catch(reason => {
    console.log(reason);
  })

  return searchResults;
}

function getFingerPrint(path) {
  const height = 480
  const width = 480

  return sharp(path)
    .resize({ height, width, fit: 'fill'})
    .toBuffer()
    .then(buffer => {
      var rawImage = jpeg.decode(buffer, true);
      return {
        width: width,
        height: 1,
        data: getKeyLinesFromImage(rawImage)
      }
    })
}

function extractMetadata(path) {
  function success(exifData) {
    let dateTaken = null;
    if (exifData && exifData.exif && exifData.exif.DateTimeOriginal) {
      dateTaken = moment(exifData.exif.DateTimeOriginal);
    } else {
      dateTaken = getDateFromFilePath(path);
    }
    const width = exifData && exifData.image && exifData.image.ImageWidth
    const height = exifData && exifData.image && exifData.image.ImageHeight

    function withFingerprint(fingerprint) {
      const metadata = {
        fingerprint,
        path,
        dateTaken,
        width,
        height
      };
      return metadata
    }

    return getFingerPrint(path).then(withFingerprint).catch(error => null);
  }
  function error(error) {
    console.log(error);
    resolve({path: path, dateTaken: getDateFromFilePath(path)});
  }
  return exif.read(path).then(success).error(error);
}

function convertPromiseArrayIntoSinglePromise(promises) {
  return new Promise(function(resolve, reject) {
    Promise.all(promises)
      .then(results => { resolve(results) })
      .catch(reason => { console.log(reason) });
  });
}

function extractMetadataForImages(imagePaths) {
  let promises = imagePaths.map(path => extractMetadata(path));
  return convertPromiseArrayIntoSinglePromise(promises).then(metadatas => {
    return metadatas.filter(Boolean)
  })
}


// const MAX_DATE_DIFF = 1000 * 60 * 60 * 24 * 30; //one month
const MAX_DATE_DIFF = null;

//node --expose-gc index.js

let targetImagesDir = 'target-images'
// let searchDirs = ['test-images'];
let searchDirs = ['/Users/bethanyskurrie/Dropbox/Camera Uploads']
let searchResultsDir = 'search-results';
console.log("Searching for originals for", targetImagesDir, "in", searchDirs);
let searchResults = findOriginalImages(targetImagesDir, searchDirs, searchResultsDir);
