'use strict';

const fs = require('fs');
const glob = require('glob');
const path = require('path');
const resemble = require('node-resemble');
const moment = require('moment');
const exif = require('fast-exif');

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
    return moment();
  }
}

function compareImages(targetImagePath, testImagePath, handleMatchFound){
  console.log("Checking", targetImagePath, "against", testImagePath);
  let start = new Date();
  resemble(targetImagePath).compareTo(testImagePath).scaleToSameSize().onComplete(function(data){
    let end = new Date();
    console.log("Finished in", ((end-start)/1000), "seconds");
    global.gc();
    if(data.error) {
      console.error("Error reading", testImagePath);
    } else {
      if (data.rawMisMatchPercentage < 1) {
        handleMatchFound(targetImagePath, testImagePath);
      }
    }
  });
}

function prioritiseImagesWithSimilarDates(targetImagePath, testImages) {
  let targetImageDate = getDateFromFilePath(targetImagePath);
  let testImagePathsWithDateDiffs = [];

  testImages.forEach(function(testImage, index){
    let dateDifference = Math.abs(targetImageDate.diff(testImage.dateTaken));

    if((MAX_DATE_DIFF === null || dateDifference < MAX_DATE_DIFF) && testImagePathsWithDateDiffs.length < 100) {
      testImagePathsWithDateDiffs.push({path: testImage.path, diff: dateDifference});
    }
  });

  let sorted = testImagePathsWithDateDiffs.sort(function(a, b){
    return a.diff - b.diff;
  });
  let prioritisedImagePaths = sorted.map(obj => { return obj.path });
  return prioritisedImagePaths;
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
      console.log("MATCHED!", targetImagePath, "with", testImagePath);
      searchResults[targetImagePath] = testImagePath;
      moveTargetImageToFoundDir(targetImagePath, foundTargetImageDir);
      copyTestImageToSearchResultsDir(testImagePath, searchResultsDir);
    }
  };
}

function getTestImagePaths(searchDirs) {
  let testImagePaths = [];
  searchDirs.forEach(searchDir => {
    testImagePaths = testImagePaths.concat(glob.sync(searchDir + "/*.{jpg,jpeg,JPG,JPEG}", {}));
  });
  return testImagePaths;
}

function doSearch(targetImagePaths, testImages, searchResults, handleMatchFound) {
  targetImagePaths.forEach(function(targetImagePath){
    let prioritisedImagePaths = prioritiseImagesWithSimilarDates(targetImagePath, testImages);
    prioritisedImagePaths.forEach(testImagePath => {
      if(!searchResults[targetImagePath]) {
        compareImages(targetImagePath, testImagePath, handleMatchFound);
      }
    });
  });
}

function findOriginalImages(targetImagesDir, searchDirs, searchResultsDir) {
  let searchResults = {};
  let foundTargetImageDir = path.join(targetImagesDir, 'found');
  createDir(foundTargetImageDir);
  createDir(searchResultsDir);

  let targetImagePaths = glob.sync(targetImagesDir + '/*.{jpg,jpeg,JPG,JPEG}', {});
  let testImagePaths = getTestImagePaths(searchDirs);
  let handleMatchFound = createMatchFoundHandler(searchResults, foundTargetImageDir, searchResultsDir);

  let buildImagesPromise = buildImages(testImagePaths);

  buildImagesPromise.then(testImages => {
    doSearch(targetImagePaths, testImages, searchResults, handleMatchFound);
    console.log(searchResults);
  }).catch(reason => {
    console.log(reason);
  })

  return searchResults;
}

function buildImage(path) {
  return new Promise(function(resolve, reject) {
    function success(exifData) {
      let dateTaken = null;
      if (exifData && exifData.exif && exifData.exif.DateTimeOriginal) {
        dateTaken = moment(exifData.exif.DateTimeOriginal);
      } else {
        dateTaken = getDateFromFilePath(path);
      }
      resolve({path: path, dateTaken: dateTaken});
    }
    function error(error) {
      console.log(error);
      resolve({path: path, dateTaken: getDateFromFilePath(path)});
    }
    return exif.read(path).then(success).error(error);
  });
}

function buildImages(testImagePaths) {
  let promises = testImagePaths.map(path => {
    return buildImage(path);
  });

  return new Promise(function(resolve, reject) {
    Promise.all(promises)
      .then(results => { resolve(results) })
      .catch(reason => { console.log(reason) });
  });
}


// const MAX_DATE_DIFF = 1000 * 60 * 60 * 24 * 30; //one month
const MAX_DATE_DIFF = null;

//node --expose-gc index.js

let targetImagesDir = 'target-images'
let searchDirs = ['test-images'];
let searchResultsDir = 'search-results';
console.log("Searching for originals for ", targetImagesDir, "in", searchDirs);
let searchResults = findOriginalImages(targetImagesDir, searchDirs, searchResultsDir);
