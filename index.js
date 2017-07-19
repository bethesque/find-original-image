'use strict';

const fs = require('fs');
const glob = require('glob');
const path = require('path');
const resemble = require('node-resemble');
const moment = require('moment');

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
  resemble(targetImagePath).compareTo(testImagePath).scaleToSameSize().onComplete(function(data){
    if(data.error) {
      console.error("Error reading", testImagePath);
    } else {
      if (data.rawMisMatchPercentage < 1) {
        handleMatchFound(targetImagePath, testImagePath);
      }
    }
  });
}

function prioritiseImagesWithSimilarDates(targetImagePath, testImagePaths) {
  let targetImageDate = getDateFromFilePath(targetImagePath);
  let testImagePathsWithDateDiffs = [];

  testImagePaths.forEach(function(testImagePath, index){
    let dateDifference = targetImageDate.diff(getDateFromFilePath(testImagePath));
    testImagePathsWithDateDiffs.push({path: testImagePath, diff: Math.abs(dateDifference)});
  });

  let sorted = testImagePathsWithDateDiffs.sort(function(a, b){
    return a.diff - b.diff;
  });
  return sorted.map(obj => { return obj.path });
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

function findOriginalImages(targetImagesDir, searchDirs, searchResultsDir) {
  let targetImagePaths = glob.sync(targetImagesDir + '/*.{jpg,jpeg}', {});
  let foundTargetImageDir = path.join(targetImagesDir, 'found');
  let searchResults = {};
  createDir(foundTargetImageDir);
  createDir(searchResultsDir);

  var handleMatchFound = function(targetImagePath, testImagePath) {
    if(!searchResults[targetImagePath]) {
      console.log("MATCHED!", targetImagePath, "with", testImagePath);
      searchResults[targetImagePath] = testImagePath;
      moveTargetImageToFoundDir(targetImagePath, foundTargetImageDir);
      copyTestImageToSearchResultsDir(testImagePath, searchResultsDir);
    }
  };

  let testImagePaths = [];
  searchDirs.forEach(searchDir => {
    testImagePaths = testImagePaths.concat(glob.sync(searchDir + "/*.{jpg,jpeg}", {}));
  });

  targetImagePaths.forEach(function(targetImagePath){
    let prioritisedImagePaths = prioritiseImagesWithSimilarDates(targetImagePath, testImagePaths);
    prioritisedImagePaths.forEach(testImagePath => {
      if(!searchResults[targetImagePath]) {
        compareImages(targetImagePath, testImagePath, handleMatchFound);
      }
    });
  });

  return searchResults;
}

let targetImagesDir = '/Users/Beth/Pictures/Tinybeans/2016-photos';
let searchDirs = glob.sync("/Users/Beth/Pictures/_EXPORTS/*", {});
// let searchDirs = ['/Users/Beth/Dropbox/Camera Uploads 2017-06-30'];
let searchResultsDir = 'search-results';
console.log("Searching for originals for ", targetImagesDir, "in", searchDirs);
let searchResults = findOriginalImages(targetImagesDir, searchDirs, searchResultsDir);

console.log(searchResults);