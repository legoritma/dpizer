// Constants
var SIZES = {
    'xxxhdpi'   : 4.00,
    'xxhdpi'    : 3.00,
    'xhdpi'     : 2.00,
    'hdpi'      : 1.50,
    //'tvdpi'     : 1.33,
    'mdpi'      : 1.00,
    'ldpi'      : 0.75
};

// Global vars
var cwd = null;
var sdpi = null; // Source DPI select
var calculatedSizes = null; // Target DPI's
var zip = null;
var blob = null;

// Async callback controll variables
var clearCount;
var dropCount;
var resizeCount;

// Flags
var disableDrop = false;

// Step Wrappers
var sourceStep = document.getElementById('source_step');
var targetStep = document.getElementById('target_step');
var finalStep = document.getElementById('final_step');

window.addEventListener('load', init);
function init() {
    setInst('Preparing system...');
    prepareFileSystem();
    prepareDom();
    dragAndDropInit();
}

function prepareDom() {
    // Register buttons' events
    document.getElementById('source_btn').onclick = sdpiControl;
    document.getElementById('target_btn').onclick = tdpiControl;
    document.getElementById('download_btn').onclick = downloadPackage;
    
    var p_el = document.getElementById('privacy');
    document.getElementById('privacy_t').onclick = function() {
        p_el.classList.add('open');
    };
    p_el.getElementsByClassName('close')[0].onclick = function(e) {
        e.preventDefault();
        p_el.classList.remove('open');
    };
    
    
    // Append DPIs
    var sdpiTpl = document.getElementById('tpl-sdpi').innerHTML.trim();
    var tdpiTpl = document.getElementById('tpl-tdpi').innerHTML.trim();
    var s_out = "";
    var t_out = "";
    for (var dpi in SIZES) {
        s_out += sdpiTpl.replace(/{%size%}/g, dpi);
        t_out += tdpiTpl.replace(/{%size%}/g, dpi);
    }
    
    document.getElementById('source_dpi').innerHTML += s_out;
    document.getElementById('target_dpi').innerHTML += t_out;
}

function prepareFileSystem() {
    // TODO: Error if not exist
    window.requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
    //window.resolveLocalFileSystemURL = window.webkitResolveLocalFileSystemURL || window.webkitResolveLocalFileSystemURL;
    
    var dirCleared = function() {
        setInst('GIMME FOLDER!', 'drag&drop your asset folder here');
    };
    
    window.requestFileSystem(TEMPORARY, 1024 * 1204, function(fileSystem) {
        cwd = fileSystem.root;
        
        // Clear Previous files
        var dirReader = fileSystem.root.createReader();
        clearCount = 1;
        dirReader.readEntries(function(entries) {
            clearCount += entries.length; // pre count all callbacks
            for (var i = entries.length - 1; i >= 0; --i) {
                var entry = entries[i];
                if (entry.isDirectory) {
                    entry.removeRecursively(function() {
                        asyncCheck(--clearCount, dirCleared);
                    }, onError);
                } else {
                    entry.remove(function() {
                        asyncCheck(--clearCount, dirCleared);
                    }, onError);
                }
            }
            asyncCheck(--clearCount, dirCleared);
        }, onError);
    }, onError);
}

function dragAndDropInit() {
    var dropEl = document.getElementById('droparea');
    dropEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (!this.classList.contains('white'))
            this.classList.add('over');
    });
    
    dropEl.addEventListener('dragleave', function (e) {
        e.preventDefault();
        if (!this.classList.contains('white'))
            this.classList.remove('over');
    });
    
    dropEl.addEventListener('drop', function (e) {
        e.preventDefault();
        if (!this.classList.contains('white'))
            this.classList.remove('over');
        if (!disableDrop) {
            var items = e.dataTransfer.items;
            if (items.length != 1) {
                setInst('Hey! Drop single folder!');
            } else {
                var entry = items[0].webkitGetAsEntry();
                if (!entry.isDirectory) {
                    setInst('Hey! Drop single folder!');
                } else {
                    entry.createReader().readEntries(function(e) {
                        if (e.length > 0) {
                            entry.copyTo(cwd, null, function(copiedEntry) {
                                cwd = copiedEntry;
                                sdpiStep();
                            }, onError); 
                        } else {
                            setInst('Hey! This is an empty folder!!!');
                        }
                    });
                }
            }
        }
    });
}


function sdpiStep() {
    var sizeKeys = Object.keys(SIZES);
    var predictSize = cwd.name.match(new RegExp(sizeKeys.join("|")));
    if (predictSize == null) {
        setInst("What's your asset's DPI?");
    } else {
        setInst(
            "What's your asset's DPI?",
            "I think it's \"" + predictSize + "\""
        );
        sdpi = predictSize;
        document.getElementById('s_' + predictSize).checked = true;
    }
    
    // Disable drop
    disableDrop = true;
    document.getElementById('droparea').classList.add('white', 'shake');
    
    // Show DPIs
    sourceStep.classList.remove('closed');
    trackPage('sdpi');
}

function sdpiControl() {
    var selected_sdpi = document.querySelector('[name=sdpi]:checked');
    if (selected_sdpi) {
        setInst('Select your target DPIs!');
        trackPage('tdpi');

        sourceStep.classList.add('closed');
        targetStep.classList.remove('closed');

        sdpi = selected_sdpi.value;
        var tdpiElements = document.getElementsByName('tdpi');
        
        var changeAvailable = function(el, av, timeout) {
            setTimeout(function() {
                el.disabled = av;
                //el.checked = !av;
            }, timeout);
        };
        for (var i = tdpiElements.length - 1; i >= 0; i--) {
            changeAvailable(
                tdpiElements[i],
                SIZES[tdpiElements[i].value] >= SIZES[sdpi],
                (i * 100) + 300
            );
        }
    }
}

function tdpiControl() {
    var selectedTdpiEls = document.querySelectorAll('[name=tdpi]:checked');
    calculatedSizes = {};

    if (selectedTdpiEls.length > 0) {
        for (var i = selectedTdpiEls.length - 1; i >= 0; i--) {
            var factor = SIZES[selectedTdpiEls[i].value] / SIZES[sdpi];
            calculatedSizes[selectedTdpiEls[i].value] = factor;
        }
        targetStep.classList.add('closed');
        generateDpiStep();
    } else {
        setInst('OMG! Select your target DPI!');
    }
}

// Resize
function generateDpiStep() {
    setInst('Resizing images...');
    zip = new JSZip();
    resizeCount = 0;
    traverseFileTree(cwd, generateDpiWrapper);
}

function traverseFileTree(dirEntry, callback) {
    var dirReader = dirEntry.createReader();
    dirReader.readEntries (function(entries) {
        for (var i = entries.length - 1; i >= 0; --i) {
            var entry = entries[i];
            if (entry.isDirectory) {
                traverseFileTree(entry, callback);
            } else {
                callback(entry);
            }
        }
    });
}


function generateDpiWrapper(fileEntry) {
    fileEntry.file(function(file) {
        if (file.type.match('^image/')) {
            for (var dpi in calculatedSizes) {
                ++resizeCount;
                resizeImage(
                    file,
                    calculatedSizes[dpi],
                    getOutputPath(fileEntry.fullPath, dpi)
                );
            }
        }
    });
}


function getOutputPath(inPath, size) {
    return inPath.replace(cwd.fullPath, 'drawable-' + size);
}

function resizeImage(file, ratio, fullPath) {
    var fileReader = new FileReader();

    fileReader.onload = function (e) {
        var img = document.createElement('img');
        var canvas = document.createElement('canvas');
        
        img.setAttribute('src', e.target.result);
        var ctx = canvas.getContext("2d");
        var stepSize = 0.5;
        var steps = Math.ceil(Math.log(1 / ratio) / Math.log(1 / stepSize));

        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;

        if (steps > 1) {
            // step resize for proper interpolation
            var oc = document.createElement('canvas');
            var octx = oc.getContext('2d');
            var stepRatio = stepSize;
            oc.width  = img.width  * stepSize;
            oc.height = img.height * stepSize;

            octx.drawImage(img, 0, 0, oc.width, oc.height);

            while (--steps > 1) {
                octx.drawImage(oc, 0, 0, oc.width * stepSize, oc.height * stepSize);
                stepRatio *= stepSize;
            }

            var finalRatio = ratio / stepRatio;
            octx.drawImage(oc, 0, 0, oc.width * finalRatio, oc.height * finalRatio);

            ctx.drawImage(
                oc,
                0, 0, canvas.width, canvas.height,
                0, 0, canvas.width, canvas.height
            );
        } else {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        
        var dataurl = canvas.toDataURL(file.type);
        zip.file(fullPath, dataurl.split(',')[1], {base64: true});
        asyncCheck(--resizeCount, resizeComplete);
    };
    
    fileReader.readAsDataURL(file);
}

function resizeComplete() {
    blob = zip.generate({type:"blob"});
    document.getElementById('droparea').classList.remove('shake');
    finalStep.classList.remove('closed');
    setInst('All assets were created.', 'Thanks for watching');
    trackPage('resized');
}

function downloadPackage() {
    saveAs(blob, cwd.name + "_dpizer.zip");
    setInst('Thank You');
    trackPage('download');
}


// General Functions
function onError(e) {
    document.getElementById('droparea').classList.add('white', 'error');
    setInst("Error!", "Something wrong happened :(<br />Maybe you're browsing in private mode?");
    trackPage('error');
}

function setInst(main, desc) {
    document.getElementById('instruction').innerHTML = '<p>' + main + '</p>' + ((desc) ? '<i>' + desc + '</i>' : '');
}

function asyncCheck(count, callback) {
    if (count === 0) {
        if (callback && typeof(callback) === 'function') callback();
    }
}

function trackPage(page) {
    // TODO: maybe html5 history?
    if (typeof ga !== "undefined" && ga !== null) {
        ga('send','pageview', page);
    }
}