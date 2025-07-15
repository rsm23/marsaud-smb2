var SMB2Forge = require('../tools/smb2-forge');
var SMB2Request = SMB2Forge.request;

/*
 * mkdirp
 * ======
 *
 * create folder recursively:
 *
 *  - split the path into components
 *  - check if each parent directory exists
 *  - create missing parent directories one by one
 *  - create the target directory
 *
 */
module.exports = function mkdirp(path, mode, cb) {
  if (typeof mode === 'function') {
    cb = mode;
    mode = '0777';
  }

  var connection = this;

  // Normalize path separators - SMB uses backslashes
  var normalizedPath = path.replace(/\//g, '\\');

  // Split path into components, filter out empty strings
  var pathComponents = normalizedPath.split('\\').filter(function(component) {
    return component.length > 0;
  });

  if (pathComponents.length === 0) {
    return cb && cb(new Error('Invalid path'));
  }

  // Build paths progressively
  var pathsToCreate = [];
  var currentPath = '';

  for (var i = 0; i < pathComponents.length; i++) {
    if (i === 0 && pathComponents[i].length === 0) {
      // Skip empty first component (absolute path)
      continue;
    }

    if (currentPath) {
      currentPath += '\\' + pathComponents[i];
    } else {
      currentPath = pathComponents[i];
    }

    pathsToCreate.push(currentPath);
  }

  // Function to create directories recursively
  function createDirectories(index, retryCount) {
    if (index >= pathsToCreate.length) {
      return cb && cb(null);
    }

    var currentPath = pathsToCreate[index];
    retryCount = retryCount || 0;
    var maxRetries = 5;
    var retryDelay = Math.min(100 * Math.pow(2, retryCount), 1000); // Exponential backoff, max 1s

    // Check if directory already exists
    SMB2Request(
      'open_folder',
      { path: currentPath },
      connection,
      function(err, file) {
        if (!err) {
          // Directory exists, close it and move to next
          SMB2Request('close', file, connection, function() {
            createDirectories(index + 1, 0);
          });
        } else if (
          err.code === 'STATUS_OBJECT_NAME_NOT_FOUND' ||
          err.code === 'STATUS_OBJECT_PATH_NOT_FOUND'
        ) {
          // Directory doesn't exist, create it
          SMB2Request(
            'create_folder',
            { path: currentPath },
            connection,
            function(err, file) {
              if (err) {
                // Handle STATUS_PENDING for create_folder as well
                if (err.code === 'STATUS_PENDING' && retryCount < maxRetries) {
                  setTimeout(function() {
                    createDirectories(index, retryCount + 1);
                  }, retryDelay);
                  return;
                }
                return cb && cb(err);
              }

              // Close the created directory and move to next
              SMB2Request('close', file, connection, function() {
                createDirectories(index + 1, 0);
              });
            }
          );
        } else if (err.code === 'STATUS_PENDING' && retryCount < maxRetries) {
          // Operation is pending, retry after a delay
          setTimeout(function() {
            createDirectories(index, retryCount + 1);
          }, retryDelay);
        } else {
          // Other error occurred
          return cb && cb(err);
        }
      }
    );
  }

  // Start creating directories
  createDirectories(0, 0);
};